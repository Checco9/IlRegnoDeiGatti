import { Router } from 'express';
import { requireAuth, requireGameMembership } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { resolveSkillCheck, STATS, DIFFICULTY } from '../services/ruleEngine.js';
import {
  buildPromptText,
  buildStateOnlyPromptText,
  buildTrainingPromptText,
  parseAndValidateChanges,
} from '../services/aiBridge.js';
import {
  getCompactGameState,
  appendEvent,
  saveDiceRoll,
  applyHpChange,
  applyFameChange,
  applyEnergyChange,
  applyXpChange,
  equipItem,
  unequipItem,
  allocateSkillPoint,
  addItemToInventory,
  consumeItem,
  moveToLocation,
  findQuestByTitle,
  createQuest,
  updateQuestStatus,
  getAllLocations,
  upsertNpc,
} from '../services/gameStateService.js';

const router = Router();
router.use(requireAuth);

// GET /api/games/:gameId/copy-state — testo pronto per "📋 Copia stato per IA"
router.get('/:gameId/copy-state', requireGameMembership, async (req, res) => {
  try {
    const gameState = await getCompactGameState(req.params.gameId);
    res.json({ promptText: buildStateOnlyPromptText(gameState) });
  } catch (err) {
    console.error('[actions] errore copia stato:', err);
    res.status(500).json({ error: 'Impossibile preparare lo stato.' });
  }
});

// GET /api/games/:gameId/copy-instructions — "🎓 Istruisci l'IA": le regole di
// formato + lo stato attuale, utilizzabile in QUALSIASI momento della partita
// (non solo all'inizio), per una nuova chat o per far "ricordare" il formato
// a un'IA che ha smesso di seguirlo.
router.get('/:gameId/copy-instructions', requireGameMembership, async (req, res) => {
  try {
    const gameState = await getCompactGameState(req.params.gameId);
    res.json({ promptText: buildTrainingPromptText(gameState) });
  } catch (err) {
    console.error('[actions] errore copia istruzioni:', err);
    res.status(500).json({ error: 'Impossibile preparare le istruzioni.' });
  }
});

// POST /api/games/:gameId/action-only
// Azione senza prova (certa/non rischiosa): salva l'azione e prepara il testo da copiare.
// body: { text }
router.post('/:gameId/action-only', requireGameMembership, async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Descrivi cosa vuoi fare.' });

  try {
    await appendEvent(req.params.gameId, {
      eventType: 'player_action',
      content: text.trim(),
      actorUserId: req.user.id,
    });
    const gameState = await getCompactGameState(req.params.gameId);
    res.json({ promptText: buildPromptText(gameState, text.trim(), null) });
  } catch (err) {
    console.error('[actions] errore azione:', err);
    res.status(500).json({ error: 'Impossibile registrare l\'azione.' });
  }
});

// POST /api/games/:gameId/roll
// Il PROGRAMMA (non l'IA) esegue davvero il tiro, con statistica e difficoltà scelte dal giocatore.
// body: { text, gameCharacterId, stat, difficulty }
router.post('/:gameId/roll', requireGameMembership, async (req, res) => {
  const { gameId } = req.params;
  const { text, gameCharacterId, stat, difficulty } = req.body;

  // Il testo ora è facoltativo: il tiro è "libero", pensato anche per chi vuole
  // solo il numero e poi scrive lui stesso all'IA cosa è successo.
  const actionText = text?.trim() || '';
  if (!STATS.includes(stat)) return res.status(400).json({ error: `Statistica non valida: ${stat}` });
  if (!DIFFICULTY[difficulty]) return res.status(400).json({ error: `Difficoltà non valida: ${difficulty}` });

  try {
    if (actionText) {
      await appendEvent(gameId, { eventType: 'player_action', content: actionText, actorUserId: req.user.id });
    }

    const gameState = await getCompactGameState(gameId);
    const character = gameState.personaggi.find((p) => p.game_character_id === gameCharacterId);
    const statValue = character ? character.statistiche[stat] : 0;

    const rollResult = resolveSkillCheck(statValue, difficulty);
    await saveDiceRoll(gameId, {
      gameCharacterId: gameCharacterId || null,
      stat,
      statValue,
      rollResult,
      context: actionText || '(tiro libero, senza azione descritta)',
    });
    await appendEvent(gameId, {
      eventType: 'dice_roll',
      content: `Prova di ${stat} (${character?.nome || 'sconosciuto'}): ${rollResult.roll} + ${statValue} = ${rollResult.total} vs difficoltà ${rollResult.difficulty} → ${rollResult.success ? 'successo' : 'fallimento'}`,
    });

    const freshState = await getCompactGameState(gameId);
    const promptText = buildPromptText(
      freshState,
      actionText || 'Tiro libero: il giocatore ti dirà a voce cosa stava tentando.',
      { ...rollResult, stat, statValue }
    );

    res.json({ roll: rollResult, promptText });
  } catch (err) {
    console.error('[actions] errore tiro:', err);
    res.status(500).json({ error: 'Impossibile completare il tiro.' });
  }
});

// POST /api/games/:gameId/parse-changes
// Analizza (senza scrivere nulla) il testo incollato dal giocatore e propone un'anteprima validata.
// body: { rawText }
router.post('/:gameId/parse-changes', requireGameMembership, async (req, res) => {
  const { rawText } = req.body;
  if (!rawText?.trim()) return res.status(400).json({ error: 'Incolla la risposta dell\'IA.' });

  try {
    const gameState = await getCompactGameState(req.params.gameId);
    const allLocations = await getAllLocations(req.params.gameId);
    const preview = parseAndValidateChanges(rawText, gameState, allLocations);
    res.json(preview);
  } catch (err) {
    console.error('[actions] errore analisi modifiche:', err);
    res.status(500).json({ error: 'Impossibile analizzare il testo incollato.' });
  }
});

// POST /api/games/:gameId/apply-changes
// Applica SOLO le modifiche valide (già confermate dal giocatore nell'anteprima).
// body: { narration, changes: [...] }  (esattamente ciò che /parse-changes ha restituito)
router.post('/:gameId/apply-changes', requireGameMembership, async (req, res) => {
  const { gameId } = req.params;
  const { narration, changes } = req.body;

  if (!Array.isArray(changes)) return res.status(400).json({ error: 'Nessuna modifica da applicare.' });

  try {
    if (narration?.trim()) {
      await appendEvent(gameId, { eventType: 'ai_narration', content: narration.trim() });
    }

    for (const change of changes) {
      if (!change.valid) continue; // solo le modifiche già validate dal backend vengono applicate

      switch (change.type) {
        case 'hp': {
          const { newHp, status } = await applyHpChange(change.payload.gameCharacterId, change.payload.delta);
          await appendEvent(gameId, { eventType: 'hp_change', content: `HP aggiornati: ${newHp} (${status})`, metadata: change.payload });
          break;
        }
        case 'fame': {
          const newFame = await applyFameChange(gameId, change.payload.delta);
          await appendEvent(gameId, { eventType: 'system', content: `Fama del gruppo aggiornata: ${newFame}`, metadata: change.payload });
          break;
        }
        case 'energy': {
          await applyEnergyChange(change.payload.gameCharacterId, change.payload.delta);
          await appendEvent(gameId, { eventType: 'system', content: `Energia aggiornata`, metadata: change.payload });
          break;
        }
        case 'xp': {
          const result = await applyXpChange(change.payload.gameCharacterId, change.payload.delta);
          await appendEvent(gameId, { eventType: 'system', content: `XP +${change.payload.delta} (livello ${result.newLevel})`, metadata: change.payload });
          if (result.levelsGained > 0) {
            await appendEvent(gameId, { eventType: 'system', content: `🎉 Livello superiore! Nuovo livello: ${result.newLevel} (+${result.levelsGained} punti abilità da assegnare)` });
          }
          break;
        }
        case 'equip': {
          await equipItem(change.payload.gameCharacterId, change.payload.inventoryId, change.payload.slot);
          await appendEvent(gameId, { eventType: 'item_change', content: `Equipaggiato: ${change.payload.itemName} (${change.payload.slot})`, metadata: change.payload });
          break;
        }
        case 'unequip': {
          await unequipItem(change.payload.gameCharacterId, change.payload.inventoryId);
          await appendEvent(gameId, { eventType: 'item_change', content: `Rimosso equipaggiamento: ${change.payload.slot}`, metadata: change.payload });
          break;
        }
        case 'item_add': {
          await addItemToInventory(gameId, change.payload.gameCharacterId, change.payload.itemName);
          await appendEvent(gameId, { eventType: 'item_change', content: `Oggetto aggiunto: ${change.payload.itemName}`, metadata: change.payload });
          break;
        }
        case 'item_remove': {
          const removed = await consumeItem(change.payload.gameCharacterId, change.payload.itemName);
          if (removed) {
            await appendEvent(gameId, { eventType: 'item_change', content: `Oggetto rimosso: ${change.payload.itemName}`, metadata: change.payload });
          }
          break;
        }
        case 'position': {
          await moveToLocation(gameId, change.payload.targetName, change.payload.existingLocationId);
          await appendEvent(gameId, { eventType: 'system', content: `Il gruppo si sposta: ${change.payload.targetName}` });
          break;
        }
        case 'quest': {
          let quest = await findQuestByTitle(gameId, change.payload.title);
          if (!quest && change.payload.isNew) {
            quest = await createQuest(gameId, { title: change.payload.title, status: change.payload.status });
          } else if (quest) {
            await updateQuestStatus(quest.id, change.payload.status);
          }
          await appendEvent(gameId, { eventType: 'quest_update', content: `Missione "${change.payload.title}" → ${change.payload.status}` });
          break;
        }
        case 'npc': {
          await upsertNpc(gameId, { name: change.payload.name, description: change.payload.description, isHostile: false, avatarUrl: change.payload.imagePath });
          await appendEvent(gameId, { eventType: 'npc_event', content: `NPC: ${change.payload.name}${change.payload.description ? ' — ' + change.payload.description : ''}` });
          break;
        }
        case 'enemy': {
          await upsertNpc(gameId, { name: change.payload.name, description: change.payload.description, isHostile: true, hp: change.payload.hp, avatarUrl: change.payload.imagePath });
          await appendEvent(gameId, { eventType: 'npc_event', content: `Nemico: ${change.payload.name} (HP ${change.payload.hp})${change.payload.description ? ' — ' + change.payload.description : ''}` });
          break;
        }
        case 'scene': {
          await supabaseAdmin.from('games').update({ current_scene_type: change.payload.sceneType }).eq('id', gameId);
          break;
        }
        case 'event': {
          await appendEvent(gameId, { eventType: 'system', content: change.payload.text });
          break;
        }
        default:
          break; // tipo sconosciuto: ignorato per sicurezza
      }
    }

    const updatedState = await getCompactGameState(gameId);
    res.json({ ok: true, stato: updatedState });
  } catch (err) {
    console.error('[actions] errore applicazione modifiche:', err);
    res.status(500).json({ error: 'Impossibile applicare le modifiche.' });
  }
});

// POST /api/games/:gameId/inventory/:inventoryId/equip
// Equipaggiare/togliere un oggetto è un'azione meccanica: il giocatore può farla
// direttamente dal programma, senza passare dall'IA (che però può proporlo lo
// stesso tramite EQUIPAGGIA/RIMUOVI EQUIPAGGIAMENTO nel testo importato).
router.post('/:gameId/inventory/:inventoryId/equip', requireGameMembership, async (req, res) => {
  const { gameCharacterId, slot } = req.body;
  if (!gameCharacterId || !slot) return res.status(400).json({ error: 'gameCharacterId e slot sono obbligatori.' });
  try {
    await equipItem(gameCharacterId, req.params.inventoryId, slot);
    const stato = await getCompactGameState(req.params.gameId);
    res.json({ ok: true, stato });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/games/:gameId/inventory/:inventoryId/unequip
router.post('/:gameId/inventory/:inventoryId/unequip', requireGameMembership, async (req, res) => {
  const { gameCharacterId } = req.body;
  if (!gameCharacterId) return res.status(400).json({ error: 'gameCharacterId obbligatorio.' });
  try {
    await unequipItem(gameCharacterId, req.params.inventoryId);
    const stato = await getCompactGameState(req.params.gameId);
    res.json({ ok: true, stato });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/games/:gameId/characters/:gameCharacterId/allocate-skill
// La "pagina" di assegnazione punto abilità: chiamata quando il personaggio
// sale di livello e ha almeno un punto da spendere.
router.post('/:gameId/characters/:gameCharacterId/allocate-skill', requireGameMembership, async (req, res) => {
  const { stat } = req.body;
  try {
    await allocateSkillPoint(req.params.gameCharacterId, stat);
    const stato = await getCompactGameState(req.params.gameId);
    res.json({ ok: true, stato });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
