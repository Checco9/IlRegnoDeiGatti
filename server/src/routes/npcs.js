import { Router } from 'express';
import { requireAuth, requireGameMembership, requireOwner } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { ensureUniqueSlug } from '../services/gameStateService.js';

const router = Router();
router.use(requireAuth);

// GET /api/games/:gameId/npcs — tutti gli NPC della partita, con i luoghi associati
// (per la sezione "Configura"; la lista degli NPC PRESENTI in scena resta invece
// quella già esposta dentro lo stato compatto della partita).
// Aperta a tutti i membri (serve anche ai giocatori per vedere gli NPC), ma
// chi non è proprietario non riceve i campi pensati come segreti del master.
router.get('/:gameId/npcs', requireGameMembership, async (req, res) => {
  try {
    const { data: npcs, error } = await supabaseAdmin
      .from('npcs')
      .select('*')
      .eq('game_id', req.params.gameId)
      .order('created_at', { ascending: true });
    if (error) throw error;

    const npcIds = npcs.map((n) => n.id);
    let associationsByNpc = {};
    if (npcIds.length) {
      const { data: links, error: linkErr } = await supabaseAdmin
        .from('npc_locations')
        .select('npc_id, location_id')
        .in('npc_id', npcIds);
      if (linkErr) throw linkErr;
      associationsByNpc = links.reduce((acc, l) => {
        acc[l.npc_id] = acc[l.npc_id] || [];
        acc[l.npc_id].push(l.location_id);
        return acc;
      }, {});
    }

    const isOwner = req.gameRole === 'proprietario';
    res.json(npcs.map((n) => {
      const payload = { ...n, associatedLocationIds: associationsByNpc[n.id] || [] };
      // FIX SICUREZZA: known_secrets e relationship_notes sono pensati per
      // restare visibili solo al master (proprietario). Prima venivano
      // mandati a chiunque fosse membro della partita, in chiaro.
      if (!isOwner) {
        delete payload.known_secrets;
        delete payload.relationship_notes;
      }
      return payload;
    }));
  } catch (err) {
    console.error('[npcs] errore lista:', err);
    res.status(500).json({ error: 'Impossibile caricare gli NPC.' });
  }
});

// POST /api/games/:gameId/npcs — crea un NPC dalla sezione Configura (solo il proprietario)
// body: { name, description, imageUrl, fallbackImage, isHostile, hp, associatedLocationIds: [] }
router.post('/:gameId/npcs', requireGameMembership, requireOwner, async (req, res) => {
  const { name, description, imageUrl, fallbackImage, isHostile, hp, associatedLocationIds } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Il nome dell\'NPC è obbligatorio.' });

  try {
    const slug = await ensureUniqueSlug('npcs', req.params.gameId, name);
    const fields = {
      game_id: req.params.gameId,
      name: name.trim(),
      slug,
      description: description || '',
      avatar_url: imageUrl || null,
      fallback_image: fallbackImage || null,
      is_hostile: Boolean(isHostile),
    };
    if (isHostile) {
      fields.hp = hp || 10;
      fields.max_hp = hp || 10;
      fields.difficulty = 12;
    }

    const { data: npc, error } = await supabaseAdmin.from('npcs').insert(fields).select('*').single();
    if (error) throw error;

    if (Array.isArray(associatedLocationIds) && associatedLocationIds.length) {
      await supabaseAdmin.from('npc_locations').insert(
        associatedLocationIds.map((locationId) => ({ npc_id: npc.id, location_id: locationId }))
      );
    }

    res.status(201).json({ ...npc, associatedLocationIds: associatedLocationIds || [] });
  } catch (err) {
    console.error('[npcs] errore creazione:', err);
    res.status(500).json({ error: 'Impossibile creare l\'NPC.' });
  }
});

// PUT /api/games/:gameId/npcs/:npcId — modifica un NPC (Configura, solo il proprietario)
router.put('/:gameId/npcs/:npcId', requireGameMembership, requireOwner, async (req, res) => {
  const { name, description, imageUrl, fallbackImage, isHostile, hp, slug, associatedLocationIds } = req.body;
  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (description !== undefined) updates.description = description;
  if (imageUrl !== undefined) updates.avatar_url = imageUrl || null;
  if (fallbackImage !== undefined) updates.fallback_image = fallbackImage || null;
  if (isHostile !== undefined) updates.is_hostile = Boolean(isHostile);
  if (hp !== undefined) { updates.hp = hp; updates.max_hp = hp; }

  try {
    if (slug !== undefined && slug.trim()) {
      updates.slug = await ensureUniqueSlug('npcs', req.params.gameId, slug, req.params.npcId);
    }

    const { data: npc, error } = await supabaseAdmin
      .from('npcs')
      .update(updates)
      .eq('id', req.params.npcId)
      .eq('game_id', req.params.gameId)
      .select('*')
      .single();
    if (error) throw error;

    if (Array.isArray(associatedLocationIds)) {
      await supabaseAdmin.from('npc_locations').delete().eq('npc_id', req.params.npcId);
      if (associatedLocationIds.length) {
        await supabaseAdmin.from('npc_locations').insert(
          associatedLocationIds.map((locationId) => ({ npc_id: req.params.npcId, location_id: locationId }))
        );
      }
    }

    res.json({ ...npc, associatedLocationIds: associatedLocationIds || [] });
  } catch (err) {
    console.error('[npcs] errore modifica:', err);
    res.status(500).json({ error: 'Impossibile modificare l\'NPC.' });
  }
});

// DELETE /api/games/:gameId/npcs/:npcId — solo il proprietario
router.delete('/:gameId/npcs/:npcId', requireGameMembership, requireOwner, async (req, res) => {
  const { error } = await supabaseAdmin
    .from('npcs')
    .delete()
    .eq('id', req.params.npcId)
    .eq('game_id', req.params.gameId);
  if (error) {
    console.error('[npcs] errore eliminazione:', error);
    return res.status(500).json({ error: 'Impossibile eliminare l\'NPC.' });
  }
  res.status(204).send();
});

export default router;
