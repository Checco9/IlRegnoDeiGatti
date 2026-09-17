import { supabaseAdmin } from '../config/supabase.js';

const RECENT_EVENTS_LIMIT = 12; // memoria "di sessione": ultimi eventi grezzi
const KEEP_ONLY_LATEST_SUMMARY = true; // memoria "permanente": riassunto capitolo più recente

/**
 * Costruisce lo stato compatto della partita da mandare all'IA.
 * Non manda MAI l'intera cronologia: solo l'ultimo riassunto + eventi recenti.
 */
export async function getCompactGameState(gameId) {
  const { effectiveStat } = await import('./ruleEngine.js');

  const [game, characters, npcs, locations, quests, recentEvents, latestSummary] =
    await Promise.all([
      supabaseAdmin.from('games').select('*').eq('id', gameId).single(),
      supabaseAdmin
        .from('game_characters')
        .select('id, current_hp, max_hp, current_energy, max_energy, level, xp, skill_points, stat_bonuses, status, characters(name, class, description, personality, forza, agilita, astuzia, coraggio, avatar_url, appearance)')
        .eq('game_id', gameId),
      supabaseAdmin.from('npcs').select('*').eq('game_id', gameId), // TUTTI gli NPC: la memoria (npc_conosciuti) li vuole anche se non "attivi"
      supabaseAdmin.from('locations').select('*').eq('game_id', gameId),
      supabaseAdmin.from('quests').select('*').eq('game_id', gameId).neq('status', 'fallita'),
      supabaseAdmin
        .from('game_events')
        .select('event_type, content, created_at')
        .eq('game_id', gameId)
        .order('created_at', { ascending: false })
        .limit(RECENT_EVENTS_LIMIT),
      supabaseAdmin
        .from('story_summaries')
        .select('*')
        .eq('game_id', gameId)
        .order('chapter_number', { ascending: false })
        .limit(KEEP_ONLY_LATEST_SUMMARY ? 1 : 5),
    ]);

  if (game.error) throw game.error;

  const currentLocation = locations.data?.find((l) => l.id === game.data.current_location_id);

  // Inventario: una query separata per ogni game_character sarebbe inefficiente,
  // quindi la facciamo in un colpo solo con IN().
  const gcIds = (characters.data || []).map((c) => c.id);
  let inventoryByCharacter = {};
  if (gcIds.length) {
    const { data: inv, error: invErr } = await supabaseAdmin
      .from('inventory')
      .select('id, game_character_id, quantity, equipped_slot, items(name, type, description)')
      .in('game_character_id', gcIds);
    if (invErr) throw invErr;
    inventoryByCharacter = inv.reduce((acc, row) => {
      acc[row.game_character_id] = acc[row.game_character_id] || [];
      acc[row.game_character_id].push({
        id: row.id,
        nome: row.items.name,
        tipo: row.items.type,
        quantita: row.quantity,
        equipaggiato: row.equipped_slot || null,
      });
      return acc;
    }, {});
  }

  return {
    titolo: game.data.title,
    tono: game.data.tone,
    ambientazione: game.data.setting,
    scena_corrente: game.data.current_scene_type,
    fama: game.data.fame ?? 0,
    luogo_corrente: currentLocation
      ? { id: currentLocation.id, slug: currentLocation.slug, nome: currentLocation.name, descrizione: currentLocation.description, immagine: currentLocation.image_url || null, fama_minima: currentLocation.min_fame ?? null }
      : null,
    personaggi: (characters.data || []).map((c) => {
      const bonuses = c.stat_bonuses || {};
      return {
        game_character_id: c.id,
        nome: c.characters.name,
        classe: c.characters.class,
        personalita: c.characters.personality,
        avatar: c.characters.avatar_url || null,
        aspetto: c.characters.appearance || {},
        hp: `${c.current_hp}/${c.max_hp}`,
        energia: `${c.current_energy}/${c.max_energy}`,
        stato: c.status,
        livello: c.level,
        xp: c.xp,
        punti_abilita_da_assegnare: c.skill_points,
        statistiche: {
          forza: effectiveStat(c.characters.forza, bonuses.forza),
          agilita: effectiveStat(c.characters.agilita, bonuses.agilita),
          astuzia: effectiveStat(c.characters.astuzia, bonuses.astuzia),
          coraggio: effectiveStat(c.characters.coraggio, bonuses.coraggio),
        },
        inventario: inventoryByCharacter[c.id] || [],
      };
    }),
    npc_presenti: (npcs.data || [])
      .filter((n) => n.status === 'attivo' && (!currentLocation || n.location_id === currentLocation.id))
      .map((n) => ({
        id: n.id,
        slug: n.slug,
        nome: n.name,
        descrizione: n.description,
        personalita: n.personality,
        relazione: n.relationship_notes,
        ostile: n.is_hostile,
        hp: n.is_hostile ? `${n.hp}/${n.max_hp}` : undefined,
        avatar: n.avatar_url || n.fallback_image || null,
        // Nessuna colonna "importanza" nel database: per ora consideriamo
        // "da mostrare in scena" un NPC con un'immagine assegnata o ostile.
        rilevante_in_scena: Boolean(n.avatar_url) || n.is_hostile,
      })),
    // Memoria di TUTTI gli NPC mai incontrati, anche se non nella scena attuale
    // o non più "attivi" (sconfitti/morti/alleati): serve a non far contraddire
    // l'IA su chi è già stato incontrato o cosa gli è successo.
    npc_conosciuti: (npcs.data || []).map((n) => ({
      slug: n.slug,
      nome: n.name,
      stato: n.status,
      relazione: n.relationship_notes || null,
    })),
    missioni_attive: (quests.data || [])
      .filter((q) => q.status === 'attiva' || q.status === 'non_iniziata')
      .map((q) => ({ titolo: q.title, tipo: q.type, stato: q.status, obiettivi: q.objectives })),
    riassunto_precedente: latestSummary.data?.[0]
      ? {
          capitolo: latestSummary.data[0].chapter_number,
          titolo: latestSummary.data[0].title,
          riassunto: latestSummary.data[0].summary,
          fatti_chiave: latestSummary.data[0].key_facts,
        }
      : null,
    eventi_recenti: (recentEvents.data || []).reverse().map((e) => ({
      tipo: e.event_type,
      testo: e.content,
    })),
  };
}

/** Salva un evento grezzo nella cronologia (memoria di sessione). */
export async function appendEvent(gameId, { eventType, content, actorUserId = null, metadata = {} }) {
  const { error } = await supabaseAdmin.from('game_events').insert({
    game_id: gameId,
    event_type: eventType,
    content,
    actor_user_id: actorUserId,
    metadata,
  });
  if (error) throw error;

  await supabaseAdmin.from('games').update({ last_active_at: new Date().toISOString() }).eq('id', gameId);
}

/** Applica una modifica di HP a un personaggio-in-partita e aggiorna il suo stato narrativo. */
export async function applyHpChange(gameCharacterId, delta) {
  const { data: gc, error: fetchErr } = await supabaseAdmin
    .from('game_characters')
    .select('current_hp, max_hp')
    .eq('id', gameCharacterId)
    .single();
  if (fetchErr) throw fetchErr;

  const { clampHp, statusForHp } = await import('./ruleEngine.js');
  const newHp = clampHp(gc.current_hp, delta, gc.max_hp);
  const newStatus = statusForHp(newHp, gc.max_hp);

  const { error: updErr } = await supabaseAdmin
    .from('game_characters')
    .update({ current_hp: newHp, status: newStatus })
    .eq('id', gameCharacterId);
  if (updErr) throw updErr;

  return { newHp, maxHp: gc.max_hp, status: newStatus };
}

/** Applica un delta di energia (mana/stamina), stesso pattern degli HP. */
export async function applyEnergyChange(gameCharacterId, delta) {
  const { data: gc, error: fetchErr } = await supabaseAdmin
    .from('game_characters')
    .select('current_energy, max_energy')
    .eq('id', gameCharacterId)
    .single();
  if (fetchErr) throw fetchErr;

  const { clampHp } = await import('./ruleEngine.js'); // stesso clamp [0, max], nome storico ma generico
  const newEnergy = clampHp(gc.current_energy, delta, gc.max_energy);

  const { error: updErr } = await supabaseAdmin
    .from('game_characters')
    .update({ current_energy: newEnergy })
    .eq('id', gameCharacterId);
  if (updErr) throw updErr;

  return { newEnergy, maxEnergy: gc.max_energy };
}

/**
 * Applica un delta di XP. Se l'xp totale fa salire di livello, aggiorna il
 * livello e accredita un punto abilità da assegnare (uno per livello salito).
 */
export async function applyXpChange(gameCharacterId, delta) {
  const { levelForXp, MAX_LEVEL } = await import('./ruleEngine.js');

  const { data: gc, error: fetchErr } = await supabaseAdmin
    .from('game_characters')
    .select('xp, level, skill_points')
    .eq('id', gameCharacterId)
    .single();
  if (fetchErr) throw fetchErr;

  const newXp = Math.max(0, gc.xp + delta);
  const newLevel = Math.min(MAX_LEVEL, levelForXp(newXp));
  const levelsGained = Math.max(0, newLevel - gc.level);
  const newSkillPoints = gc.skill_points + levelsGained;

  const { error: updErr } = await supabaseAdmin
    .from('game_characters')
    .update({ xp: newXp, level: newLevel, skill_points: newSkillPoints })
    .eq('id', gameCharacterId);
  if (updErr) throw updErr;

  return { newXp, newLevel, levelsGained, skillPoints: newSkillPoints };
}

/** Spende un punto abilità del personaggio per aumentare di 1 una statistica (in QUESTA partita). */
export async function allocateSkillPoint(gameCharacterId, stat) {
  const { MAX_STAT_BONUS } = await import('./ruleEngine.js');
  const validStats = ['forza', 'agilita', 'astuzia', 'coraggio'];
  if (!validStats.includes(stat)) throw new Error(`Statistica non valida: ${stat}`);

  const { data: gc, error: fetchErr } = await supabaseAdmin
    .from('game_characters')
    .select('skill_points, stat_bonuses')
    .eq('id', gameCharacterId)
    .single();
  if (fetchErr) throw fetchErr;

  if (gc.skill_points <= 0) throw new Error('Nessun punto abilità da assegnare.');

  const bonuses = { ...(gc.stat_bonuses || {}) };
  const current = bonuses[stat] || 0;
  if (current >= MAX_STAT_BONUS) throw new Error(`${stat} ha già il bonus massimo (+${MAX_STAT_BONUS}) per questa partita.`);
  bonuses[stat] = current + 1;

  const { error: updErr } = await supabaseAdmin
    .from('game_characters')
    .update({ skill_points: gc.skill_points - 1, stat_bonuses: bonuses })
    .eq('id', gameCharacterId);
  if (updErr) throw updErr;

  return { skillPoints: gc.skill_points - 1, statBonuses: bonuses };
}

// =========================================================
// EQUIPAGGIAMENTO — un oggetto per slot per personaggio
// =========================================================
/**
 * FIX SICUREZZA: verifica che uno o più game_character_id appartengano
 * DAVVERO alla partita indicata, prima di applicare qualunque modifica.
 * Senza questo controllo, chiunque fosse membro di UNA partita qualsiasi
 * poteva mandare al backend l'ID di un personaggio di un'ALTRA partita
 * (es. vista in precedenza) e modificarne HP/energia/inventario a piacere:
 * requireGameMembership da solo controlla solo l'appartenenza alla partita
 * nell'URL, non che gli oggetti citati nel corpo della richiesta siano
 * davvero di quella partita.
 * Restituisce l'insieme (Set) degli id che appartengono davvero alla partita.
 */
export async function filterCharacterIdsInGame(gameId, gameCharacterIds) {
  const ids = [...new Set(gameCharacterIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const { data, error } = await supabaseAdmin
    .from('game_characters')
    .select('id')
    .eq('game_id', gameId)
    .in('id', ids);
  if (error) throw error;
  return new Set(data.map((r) => r.id));
}

/** Come sopra, ma per un singolo id: true/false. */
export async function characterBelongsToGame(gameId, gameCharacterId) {
  if (!gameCharacterId) return false;
  const set = await filterCharacterIdsInGame(gameId, [gameCharacterId]);
  return set.has(gameCharacterId);
}

export const EQUIPMENT_SLOTS = ['armatura', 'amuleto'];

/** Equipaggia un oggetto della sacca in uno slot, liberando automaticamente ciò che c'era prima lì. */
export async function equipItem(gameCharacterId, inventoryId, slot) {
  if (!EQUIPMENT_SLOTS.includes(slot)) throw new Error(`Slot non valido: ${slot}`);

  const { data: row, error: findErr } = await supabaseAdmin
    .from('inventory')
    .select('id, game_character_id')
    .eq('id', inventoryId)
    .single();
  if (findErr) throw findErr;
  if (row.game_character_id !== gameCharacterId) throw new Error('Questo oggetto non appartiene a questo personaggio.');

  // libera lo slot se un altro oggetto lo occupava già
  await supabaseAdmin
    .from('inventory')
    .update({ equipped_slot: null })
    .eq('game_character_id', gameCharacterId)
    .eq('equipped_slot', slot);

  const { error: updErr } = await supabaseAdmin.from('inventory').update({ equipped_slot: slot }).eq('id', inventoryId);
  if (updErr) throw updErr;
}

/** Toglie un oggetto equipaggiato, rimettendolo nella sacca. */
export async function unequipItem(gameCharacterId, inventoryId) {
  const { error } = await supabaseAdmin
    .from('inventory')
    .update({ equipped_slot: null })
    .eq('id', inventoryId)
    .eq('game_character_id', gameCharacterId);
  if (error) throw error;
}

/** Trova la riga di inventario di un personaggio per nome oggetto (case-insensitive). Usata dal formato IA. */
export async function findInventoryRowByItemName(gameCharacterId, itemName) {
  const { data, error } = await supabaseAdmin
    .from('inventory')
    .select('id, items!inner(name)')
    .eq('game_character_id', gameCharacterId)
    .ilike('items.name', itemName)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const FAME_MIN = -100;
const FAME_MAX = 100;

/** Applica un delta alla fama del gruppo (condivisa, non per personaggio), tenuta dentro [-100, 100]. */
export async function applyFameChange(gameId, delta) {
  const { data: game, error: fetchErr } = await supabaseAdmin
    .from('games')
    .select('fame')
    .eq('id', gameId)
    .single();
  if (fetchErr) throw fetchErr;

  const newFame = Math.max(FAME_MIN, Math.min(FAME_MAX, (game.fame ?? 0) + delta));

  const { error: updErr } = await supabaseAdmin.from('games').update({ fame: newFame }).eq('id', gameId);
  if (updErr) throw updErr;

  return newFame;
}

/**
 * Aggiunge un oggetto all'inventario. SOLO il backend può chiamarla:
 * l'IA può "suggerire" un oggetto ma non crearlo mai direttamente nel DB.
 */
export async function addItemToInventory(gameId, gameCharacterId, itemName, { type = 'narrativo', description = '' } = {}) {
  let { data: item } = await supabaseAdmin
    .from('items')
    .select('id')
    .eq('game_id', gameId)
    .ilike('name', itemName)
    .maybeSingle();

  if (!item) {
    const { data: newItem, error } = await supabaseAdmin
      .from('items')
      .insert({ game_id: gameId, name: itemName, type, description })
      .select('id')
      .single();
    if (error) throw error;
    item = newItem;
  }

  const { data: existingRow } = await supabaseAdmin
    .from('inventory')
    .select('id, quantity')
    .eq('game_character_id', gameCharacterId)
    .eq('item_id', item.id)
    .maybeSingle();

  if (existingRow) {
    const { error } = await supabaseAdmin
      .from('inventory')
      .update({ quantity: existingRow.quantity + 1 })
      .eq('id', existingRow.id);
    if (error) throw error;
  } else {
    const { error } = await supabaseAdmin
      .from('inventory')
      .insert({ game_character_id: gameCharacterId, item_id: item.id, quantity: 1 });
    if (error) throw error;
  }
}

/**
 * Verifica se un personaggio possiede davvero un oggetto (case-insensitive).
 * Usata per bloccare l'IA se prova a far "usare" un oggetto inesistente.
 */
export async function characterHasItem(gameCharacterId, itemName) {
  const { data, error } = await supabaseAdmin
    .from('inventory')
    .select('quantity, items!inner(name)')
    .eq('game_character_id', gameCharacterId)
    .ilike('items.name', itemName)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data && data.quantity > 0);
}

/** Rimuove (consuma) un oggetto dall'inventario, se presente. */
export async function consumeItem(gameCharacterId, itemName) {
  const { data, error } = await supabaseAdmin
    .from('inventory')
    .select('id, quantity, items!inner(name)')
    .eq('game_character_id', gameCharacterId)
    .ilike('items.name', itemName)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.quantity <= 0) return false;

  if (data.quantity === 1) {
    await supabaseAdmin.from('inventory').delete().eq('id', data.id);
  } else {
    await supabaseAdmin.from('inventory').update({ quantity: data.quantity - 1 }).eq('id', data.id);
  }
  return true;
}

/** Salva il risultato di un tiro di dado (mai inventato dall'IA). */
export async function saveDiceRoll(gameId, { gameCharacterId = null, stat = null, statValue = null, rollResult, context }) {
  const { error } = await supabaseAdmin.from('dice_rolls').insert({
    game_id: gameId,
    game_character_id: gameCharacterId,
    stat,
    stat_value: statValue,
    raw_roll: rollResult.roll,
    total: rollResult.total,
    difficulty: rollResult.difficulty,
    success: rollResult.success,
    context,
  });
  if (error) throw error;
}

/** Aggiorna lo stato di una missione. */
export async function updateQuestStatus(questId, status) {
  const { error } = await supabaseAdmin
    .from('quests')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', questId);
  if (error) throw error;
}

/** Trova una missione per titolo (case-insensitive) dentro una partita, o null. */
export async function findQuestByTitle(gameId, title) {
  const { data, error } = await supabaseAdmin
    .from('quests')
    .select('id, title, status')
    .eq('game_id', gameId)
    .ilike('title', title)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Crea una nuova missione secondaria "al volo" quando l'IA esterna ne propone una nuova. */
export async function createQuest(gameId, { title, status = 'attiva', type = 'secondaria' }) {
  const { data, error } = await supabaseAdmin
    .from('quests')
    .insert({ game_id: gameId, title, status, type })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

/** Tutti i luoghi di una partita (per la mappa e per il matching testuale delle posizioni). */
/**
 * ID interno stabile ("slug") per location e NPC: l'IA esterna può riferirsi
 * a questo invece che al nome visualizzato, che può cambiare in qualsiasi
 * momento senza rompere i riferimenti già usati nella storia.
 */
export function slugify(text) {
  return (text || '')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // rimuove accenti
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50) || 'senza_nome';
}

/** Genera uno slug univoco dentro una tabella/partita, aggiungendo un suffisso numerico in caso di collisione. */
export async function ensureUniqueSlug(table, gameId, baseText, excludeId = null) {
  const base = slugify(baseText);
  let candidate = base;
  let attempt = 1;
  // pochi tentativi bastano: collisioni reali dentro una singola partita sono rare
  while (attempt < 50) {
    let query = supabaseAdmin.from(table).select('id').eq('game_id', gameId).eq('slug', candidate);
    if (excludeId) query = query.neq('id', excludeId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) return candidate;
    attempt += 1;
    candidate = `${base}_${attempt}`;
  }
  return `${base}_${Date.now()}`;
}

const POSITION_OFFSETS = [
  { dx: 180, dy: 0 }, { dx: -180, dy: 0 }, { dx: 0, dy: 160 }, { dx: 0, dy: -160 },
  { dx: 130, dy: 130 }, { dx: -130, dy: 130 }, { dx: 130, dy: -130 }, { dx: -130, dy: -130 },
];

/**
 * Propone una posizione iniziale sensata per un nuovo nodo della mappa,
 * vicino al luogo a cui è collegato. Chiamata SOLO alla creazione: dopo,
 * la posizione salvata (eventualmente spostata a mano dall'utente) non
 * viene mai ricalcolata automaticamente.
 */
export async function proposeInitialPosition(gameId, connectedLocationId) {
  if (!connectedLocationId) return { x: 0, y: 0 }; // prima location, o nessun collegamento: centro del canvas

  const { data: base, error } = await supabaseAdmin
    .from('locations')
    .select('x, y, connections')
    .eq('id', connectedLocationId)
    .maybeSingle();
  if (error || !base) return { x: 0, y: 0 };

  const baseX = base.x ?? 0;
  const baseY = base.y ?? 0;
  const usedCount = (base.connections || []).length;
  const offset = POSITION_OFFSETS[usedCount % POSITION_OFFSETS.length];
  return { x: baseX + offset.dx, y: baseY + offset.dy };
}

export async function getAllLocations(gameId) {
  const { data, error } = await supabaseAdmin
    .from('locations')
    .select('*')
    .eq('game_id', gameId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * Sposta la partita in un nuovo luogo: se il luogo (per nome) non esiste ancora
 * lo crea, collega il luogo di partenza e quello di arrivo (mappa che si
 * costruisce da sola man mano che l'avventura procede), e aggiorna current_location_id.
 */
export async function moveToLocation(gameId, targetName, existingLocationId = null) {
  let targetId = existingLocationId;

  const { data: game, error: gameErr } = await supabaseAdmin
    .from('games')
    .select('current_location_id')
    .eq('id', gameId)
    .single();
  if (gameErr) throw gameErr;

  if (!targetId) {
    const slug = await ensureUniqueSlug('locations', gameId, targetName);
    const pos = await proposeInitialPosition(gameId, game.current_location_id);
    const { data: newLoc, error } = await supabaseAdmin
      .from('locations')
      .insert({ game_id: gameId, name: targetName, description: '', slug, x: pos.x, y: pos.y })
      .select('id')
      .single();
    if (error) throw error;
    targetId = newLoc.id;
  }

  if (game.current_location_id && game.current_location_id !== targetId) {
    await connectLocations(gameId, game.current_location_id, targetId, 'passaggio narrato');
  }

  await supabaseAdmin.from('games').update({ current_location_id: targetId }).eq('id', gameId);
  return targetId;
}

/** Collega due luoghi in entrambe le direzioni (per la mappa). */
export async function connectLocations(gameId, locationAId, locationBId, label = '') {
  const { data: locs, error } = await supabaseAdmin
    .from('locations')
    .select('id, name, connections')
    .eq('game_id', gameId)
    .in('id', [locationAId, locationBId]);
  if (error) throw error;

  const a = locs.find((l) => l.id === locationAId);
  const b = locs.find((l) => l.id === locationBId);
  if (!a || !b) return;

  const addIfMissing = (loc, otherId) => {
    const conns = Array.isArray(loc.connections) ? loc.connections : [];
    if (!conns.some((c) => c.to === otherId)) conns.push({ to: otherId, label });
    return conns;
  };

  await supabaseAdmin.from('locations').update({ connections: addIfMissing(a, b.id) }).eq('id', a.id);
  await supabaseAdmin.from('locations').update({ connections: addIfMissing(b, a.id) }).eq('id', b.id);
}

/**
 * Genera (o aggiorna) il riassunto del capitolo corrente, per tenere
 * la memoria permanente compatta senza mandare tutta la cronologia all'IA.
 */
export async function saveChapterSummary(gameId, { title, summary, keyFacts = [] }) {
  const { count } = await supabaseAdmin
    .from('story_summaries')
    .select('*', { count: 'exact', head: true })
    .eq('game_id', gameId);

  if (error) throw error;
}

/**
 * FASE 4 (NPC visivi): crea o aggiorna un NPC per nome (case-insensitive)
 * dentro una partita. Se esiste già, aggiorna descrizione/ostilità/HP e lo
 * "sposta" nel luogo attuale (semplificazione: un NPC citato di nuovo si
 * considera presente qui). Se non esiste, lo crea nel luogo attuale.
 */
export async function upsertNpc(gameId, { name, description = '', isHostile = false, hp = null, avatarUrl = null }) {
  const { data: game, error: gameErr } = await supabaseAdmin
    .from('games')
    .select('current_location_id')
    .eq('id', gameId)
    .single();
  if (gameErr) throw gameErr;

  // L'IA può riferirsi all'NPC sia con l'ID interno stabile (slug, es. "npc_giovanni")
  // sia col nome visualizzato: proviamo prima lo slug esatto, poi il nome.
  let existing = null;
  {
    const { data, error } = await supabaseAdmin
      .from('npcs').select('id').eq('game_id', gameId).eq('slug', name).maybeSingle();
    if (error) throw error;
    existing = data;
  }
  if (!existing) {
    const { data, error } = await supabaseAdmin
      .from('npcs').select('id').eq('game_id', gameId).ilike('name', name).maybeSingle();
    if (error) throw error;
    existing = data;
  }

  const fields = {
    description: description || undefined,
    location_id: game.current_location_id,
    is_hostile: isHostile,
    status: 'attivo',
  };
  if (avatarUrl) fields.avatar_url = avatarUrl;
  if (isHostile) {
    fields.hp = hp;
    fields.max_hp = hp;
    fields.difficulty = 12;
  }
  // rimuove chiavi undefined per non sovrascrivere una descrizione esistente con vuoto
  Object.keys(fields).forEach((k) => fields[k] === undefined && delete fields[k]);

  if (existing) {
    const { error } = await supabaseAdmin.from('npcs').update(fields).eq('id', existing.id);
    if (error) throw error;
    return existing.id;
  }

  const slug = await ensureUniqueSlug('npcs', gameId, name);
  const { data: created, error } = await supabaseAdmin
    .from('npcs')
    .insert({ game_id: gameId, name, slug, ...fields })
    .select('id')
    .single();
  if (error) throw error;
  return created.id;
}
