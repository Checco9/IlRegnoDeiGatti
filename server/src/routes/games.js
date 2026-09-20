import { Router } from 'express';
import { requireAuth, requireGameMembership, requireOwner } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { getCompactGameState, appendEvent, moveToLocation, connectLocations, ensureUniqueSlug, proposeInitialPosition } from '../services/gameStateService.js';
import { buildPromptText } from '../services/aiBridge.js';

const router = Router();
router.use(requireAuth);

// GET /api/games — le partite dell'utente (proprietario o partecipante)
router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('game_players')
    .select('role, games(id, title, tone, status, created_at, last_active_at)')
    .eq('user_id', req.user.id);
  if (error) { console.error('[games] errore lista partite:', error); return res.status(500).json({ error: 'Impossibile caricare le tue partite.' }); }
  res.json(data.map((row) => ({ ...row.games, role: row.role })));
});

// GET /api/games/:gameId — stato compatto completo (per renderizzare l'interfaccia)
router.get('/:gameId', requireGameMembership, async (req, res) => {
  try {
    const state = await getCompactGameState(req.params.gameId);
    state.mio_ruolo = req.gameRole; // 'proprietario' | 'giocatore' — usato dal frontend per mostrare/nascondere le azioni da master
    res.json(state);
  } catch (err) {
    console.error('[games] errore stato partita:', err);
    res.status(500).json({ error: 'Impossibile caricare la partita.' });
  }
});

// POST /api/games — wizard "nuova avventura"
// body: { title, tone, characterIds: [id personaggi da usare in questa partita] }
// NOTA: qui il programma NON contatta nessuna IA. Crea la partita "vuota" e
// prepara il testo che il giocatore copierà nella propria IA esterna per
// generare l'apertura (stesso meccanismo usato poi per ogni azione).
router.post('/', async (req, res) => {
  const { title, tone, characterIds } = req.body;

  if (!title?.trim()) return res.status(400).json({ error: 'Il titolo è obbligatorio.' });
  if (!Array.isArray(characterIds) || characterIds.length === 0) {
    return res.status(400).json({ error: 'Seleziona almeno un personaggio.' });
  }

  const validTones = ['comica', 'avventurosa', 'misteriosa', 'assurda', 'epica'];
  const chosenTone = validTones.includes(tone) ? tone : 'avventurosa';

  try {
    const { data: chars, error: charsErr } = await supabaseAdmin
      .from('characters')
      .select('*')
      .eq('owner_id', req.user.id) // FIX SICUREZZA: senza questo, chiunque poteva pescare la scheda di un personaggio altrui indovinandone l'ID
      .in('id', characterIds);
    if (charsErr) throw charsErr;
    if (!chars.length) return res.status(400).json({ error: 'Personaggi non trovati.' });

    const { data: game, error: gameErr } = await supabaseAdmin
      .from('games')
      .insert({ owner_id: req.user.id, title: title.trim(), tone: chosenTone })
      .select('*')
      .single();
    if (gameErr) throw gameErr;

    await supabaseAdmin.from('game_players').insert({ game_id: game.id, user_id: req.user.id, role: 'proprietario' });

    const gameCharacterRows = chars.map((c) => ({
      game_id: game.id,
      character_id: c.id,
      user_id: c.owner_id,
      current_hp: c.base_hp,
      max_hp: c.base_hp,
      current_energy: c.base_energy ?? 10,
      max_energy: c.base_energy ?? 10,
    }));
    const { error: gcErr } = await supabaseAdmin.from('game_characters').insert(gameCharacterRows);
    if (gcErr) throw gcErr;

    await appendEvent(game.id, {
      eventType: 'system',
      content: `Nuova avventura creata: "${game.title}" (tono: ${chosenTone}).`,
    });

    const gameState = await getCompactGameState(game.id);
    const openingRequest = [
      `Genera l'apertura di una nuova avventura di "GDR dei Gatti", tono ${chosenTone}, `,
      `per i personaggi elencati nello stato qui sotto. Presenta un luogo iniziale, `,
      `un piccolo obiettivo o mistero da scoprire, e se ti sembra naturale un NPC. `,
      `Nella sezione MODIFICHE DA APPLICARE includi sempre POSIZIONE (nome del luogo `,
      `iniziale) e MISSIONE (titolo → attiva).`,
    ].join('');
    const promptText = buildPromptText(gameState, openingRequest, null);

    res.status(201).json({ game, promptText, stato: gameState });
  } catch (err) {
    console.error('[games] errore creazione partita:', err);
    res.status(500).json({ error: 'Impossibile creare la partita.' });
  }
});

// GET /api/games/:gameId/locations — mappa narrativa (luoghi scoperti + collegamenti)
router.get('/:gameId/locations', requireGameMembership, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('locations')
    .select('id, slug, name, description, image_url, music_url, discovered, connections, x, y, min_fame')
    .eq('game_id', req.params.gameId)
    .order('created_at', { ascending: true });
  if (error) { console.error('[games] errore lista location:', error); return res.status(500).json({ error: 'Impossibile caricare i luoghi.' }); }
  res.json(data);
});

// POST /api/games/:gameId/locations — crea manualmente un nuovo luogo (Configura / Mappa)
// body opzionale: connectedToLocationId → collega subito il nuovo luogo e ne propone
// la posizione iniziale accanto a quello; senza, il nodo nasce al centro del canvas.
router.post('/:gameId/locations', requireGameMembership, requireOwner, async (req, res) => {
  const { name, description, image_url, music_url, discovered, connectedToLocationId, min_fame } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Il nome del luogo è obbligatorio.' });

  try {
    const slug = await ensureUniqueSlug('locations', req.params.gameId, name);
    const pos = await proposeInitialPosition(req.params.gameId, connectedToLocationId || null);

    const { data, error } = await supabaseAdmin
      .from('locations')
      .insert({
        game_id: req.params.gameId,
        name: name.trim(),
        slug,
        description: description || '',
        image_url: image_url || null,
        music_url: music_url || null,
        discovered: discovered === undefined ? true : Boolean(discovered),
        min_fame: min_fame === '' || min_fame === undefined ? null : Number(min_fame),
        x: pos.x,
        y: pos.y,
      })
      .select('*')
      .single();
    if (error) throw error;

    if (connectedToLocationId) {
      await connectLocations(req.params.gameId, connectedToLocationId, data.id, '');
    }

    res.status(201).json(data);
  } catch (err) {
    console.error('[games] errore creazione location:', err);
    res.status(500).json({ error: 'Impossibile creare il luogo.' });
  }
});

// PUT /api/games/:gameId/locations/:locationId — modifica un luogo (Configura / Mappa)
router.put('/:gameId/locations/:locationId', requireGameMembership, requireOwner, async (req, res) => {
  const { name, description, image_url, music_url, discovered, slug, min_fame } = req.body;
  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (description !== undefined) updates.description = description;
  if (image_url !== undefined) updates.image_url = image_url || null;
  if (music_url !== undefined) updates.music_url = music_url || null;
  if (discovered !== undefined) updates.discovered = Boolean(discovered);
  if (min_fame !== undefined) updates.min_fame = min_fame === '' ? null : Number(min_fame);

  try {
    if (slug !== undefined && slug.trim()) {
      // l'utente vuole cambiare l'ID interno a mano: deve restare univoco nella partita
      updates.slug = await ensureUniqueSlug('locations', req.params.gameId, slug, req.params.locationId);
    }

    const { data, error } = await supabaseAdmin
      .from('locations')
      .update(updates)
      .eq('id', req.params.locationId)
      .eq('game_id', req.params.gameId)
      .select('*')
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[games] errore modifica location:', err);
    res.status(500).json({ error: 'Impossibile modificare il luogo.' });
  }
});

// PUT /api/games/:gameId/locations/:locationId/position — salva SOLO le coordinate
// (endpoint leggero e dedicato, pensato per essere chiamato spesso mentre si trascina un nodo).
router.put('/:gameId/locations/:locationId/position', requireGameMembership, async (req, res) => {
  const { x, y } = req.body;
  if (typeof x !== 'number' || typeof y !== 'number') {
    return res.status(400).json({ error: 'x e y devono essere numeri.' });
  }
  const { error } = await supabaseAdmin
    .from('locations')
    .update({ x, y })
    .eq('id', req.params.locationId)
    .eq('game_id', req.params.gameId);
  if (error) { console.error('[games] errore salvataggio posizione:', error); return res.status(500).json({ error: 'Impossibile salvare la posizione.' }); }
  res.json({ ok: true });
});

// DELETE /api/games/:gameId/locations/:locationId
router.delete('/:gameId/locations/:locationId', requireGameMembership, requireOwner, async (req, res) => {
  // FIX: impedisce di eliminare il luogo in cui si trova ATTUALMENTE il
  // gruppo. Prima si poteva, e la partita restava con "current_location_id"
  // nullo: oltre a rompere la scena visiva, causava anche la comparsa
  // casuale di NPC non pertinenti (vedi il fix nel filtro npc_presenti).
  const { data: game, error: gameErr } = await supabaseAdmin
    .from('games')
    .select('current_location_id')
    .eq('id', req.params.gameId)
    .single();
  if (gameErr) {
    console.error('[games] errore controllo luogo attuale:', gameErr);
    return res.status(500).json({ error: 'Impossibile eliminare il luogo.' });
  }
  if (game.current_location_id === req.params.locationId) {
    return res.status(400).json({
      error: 'Non puoi eliminare il luogo in cui si trova attualmente il gruppo. Spostati altrove prima di eliminarlo.',
    });
  }

  const { error } = await supabaseAdmin
    .from('locations')
    .delete()
    .eq('id', req.params.locationId)
    .eq('game_id', req.params.gameId);
  if (error) { console.error('[games] errore eliminazione location:', error); return res.status(500).json({ error: 'Impossibile eliminare il luogo.' }); }
  res.status(204).send();
});

// POST /api/games/:gameId/locations/:locationId/connect — collega due luoghi sulla mappa
router.post('/:gameId/locations/:locationId/connect', requireGameMembership, requireOwner, async (req, res) => {
  const { targetLocationId, label } = req.body;
  if (!targetLocationId) return res.status(400).json({ error: 'targetLocationId obbligatorio.' });

  try {
    await connectLocations(req.params.gameId, req.params.locationId, targetLocationId, label || '');
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('[games] errore collegamento location:', err);
    res.status(500).json({ error: 'Impossibile collegare i due luoghi.' });
  }
});

// POST /api/games/:gameId/travel — sposta la partita in un luogo già collegato e scoperto
router.post('/:gameId/travel', requireGameMembership, async (req, res) => {
  const { targetLocationId } = req.body;
  if (!targetLocationId) return res.status(400).json({ error: 'targetLocationId obbligatorio.' });

  try {
    const { data: game, error: gameErr } = await supabaseAdmin
      .from('games')
      .select('current_location_id, fame')
      .eq('id', req.params.gameId)
      .single();
    if (gameErr) throw gameErr;

    // FIX: se il luogo attuale è nullo (es. era stato eliminato prima della
    // protezione aggiunta sopra), non c'è nessun collegamento da verificare:
    // il gruppo può "ripartire" da un luogo qualsiasi invece di restare
    // bloccato per sempre senza possibilità di viaggiare.
    let connected = true;
    if (game.current_location_id) {
      const { data: current, error: curErr } = await supabaseAdmin
        .from('locations')
        .select('connections')
        .eq('id', game.current_location_id)
        .single();
      if (curErr) throw curErr;
      connected = (current.connections || []).some((c) => c.to === targetLocationId);
    }
    if (!connected) {
      return res.status(400).json({ error: 'Questo luogo non è collegato alla posizione attuale sulla mappa.' });
    }

    const { data: target } = await supabaseAdmin.from('locations').select('name, min_fame').eq('id', targetLocationId).single();

    if (target.min_fame !== null && target.min_fame !== undefined && (game.fame ?? 0) < target.min_fame) {
      return res.status(403).json({
        error: `Non siete ammessi qui: serve una fama di almeno ${target.min_fame} (ora avete ${game.fame ?? 0}).`,
      });
    }

    await moveToLocation(req.params.gameId, target.name, targetLocationId);
    await appendEvent(req.params.gameId, { eventType: 'system', content: `Il gruppo si sposta verso: ${target.name}.` });

    const state = await getCompactGameState(req.params.gameId);
    res.json({ ok: true, stato: state });
  } catch (err) {
    console.error('[games] errore viaggio:', err);
    res.status(500).json({ error: 'Impossibile spostarsi.' });
  }
});

// GET /api/games/:gameId/chronicle — cronologia leggibile (capitoli + eventi recenti)
router.get('/:gameId/chronicle', requireGameMembership, async (req, res) => {
  try {
    const [summaries, events] = await Promise.all([
      supabaseAdmin
        .from('story_summaries')
        .select('chapter_number, title, summary, created_at')
        .eq('game_id', req.params.gameId)
        .order('chapter_number', { ascending: true }),
      supabaseAdmin
        .from('game_events')
        .select('event_type, content, created_at')
        .eq('game_id', req.params.gameId)
        .order('created_at', { ascending: true })
        .limit(200),
    ]);
    if (summaries.error) throw summaries.error;
    if (events.error) throw events.error;
    res.json({ capitoli: summaries.data, eventi: events.data });
  } catch (err) {
    console.error('[games] errore cronaca:', err);
    res.status(500).json({ error: 'Impossibile caricare la cronaca.' });
  }
});

// POST /api/games/:gameId/invite — aggiunge un secondo giocatore (semplice, no inviti via email)
router.post('/:gameId/invite', requireGameMembership, requireOwner, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId obbligatorio.' });

  const { error } = await supabaseAdmin
    .from('game_players')
    .insert({ game_id: req.params.gameId, user_id: userId, role: 'giocatore' });
  if (error) { console.error('[games] errore invito:', error); return res.status(500).json({ error: 'Impossibile invitare questo utente.' }); }
  res.status(201).json({ ok: true });
});

export default router;
