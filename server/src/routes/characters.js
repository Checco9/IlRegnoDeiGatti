import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

const VALID_CLASSES = [
  'Guerriero', 'Ladro', 'Mago', 'Paladino', 'Bardo', 'Esploratore', 'Gatto Pigro', 'Divoratore',
];

// FASE 3: aspetto a livelli del gatto. Whitelist delle chiavi accettate,
// per non salvare mai JSON arbitrario proveniente dal client.
const APPEARANCE_KEYS = ['fur', 'eyes', 'clothes', 'weapon', 'accessory'];
function sanitizeAppearance(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const key of APPEARANCE_KEYS) {
    if (typeof input[key] === 'string' && input[key].trim()) {
      out[key] = input[key].trim().slice(0, 40);
    }
  }
  return out;
}

// GET /api/characters — tutti i personaggi dell'utente loggato
router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('characters')
    .select('*')
    .eq('owner_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) { console.error('[characters] errore lista:', error); return res.status(500).json({ error: 'Impossibile caricare i personaggi.' }); }
  res.json(data);
});

// POST /api/characters — crea un nuovo gatto
router.post('/', async (req, res) => {
  const { name, avatarUrl, description, personality, characterClass, stats, baseHp, baseEnergy, appearance } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Il nome è obbligatorio.' });

  const { forza = 1, agilita = 1, astuzia = 1, coraggio = 1 } = stats || {};
  for (const v of [forza, agilita, astuzia, coraggio]) {
    if (v < 0 || v > 3) return res.status(400).json({ error: 'Le statistiche devono essere tra 0 e 3.' });
  }

  const { data, error } = await supabaseAdmin
    .from('characters')
    .insert({
      owner_id: req.user.id,
      name: name.trim(),
      avatar_url: avatarUrl || null,
      description: description || '',
      personality: personality || '',
      class: VALID_CLASSES.includes(characterClass) ? characterClass : 'Esploratore',
      forza, agilita, astuzia, coraggio,
      base_hp: baseHp && baseHp > 0 ? baseHp : 20,
      base_energy: baseEnergy && baseEnergy > 0 ? baseEnergy : 10,
      appearance: sanitizeAppearance(appearance),
    })
    .select('*')
    .single();

  if (error) { console.error('[characters] errore creazione:', error); return res.status(500).json({ error: 'Impossibile creare il personaggio.' }); }
  res.status(201).json(data);
});

// PUT /api/characters/:id — modifica completa di un personaggio già creato
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const updates = {};

  if (req.body.name !== undefined && req.body.name.trim()) updates.name = req.body.name.trim();
  if (req.body.description !== undefined) updates.description = req.body.description;
  if (req.body.personality !== undefined) updates.personality = req.body.personality;

  // accetta sia "avatarUrl" (usato dal form di creazione) sia "avatar_url",
  // per non rompere eventuali chiamate già esistenti.
  if (req.body.avatarUrl !== undefined) updates.avatar_url = req.body.avatarUrl || null;
  else if (req.body.avatar_url !== undefined) updates.avatar_url = req.body.avatar_url || null;

  if (req.body.characterClass !== undefined) {
    updates.class = VALID_CLASSES.includes(req.body.characterClass) ? req.body.characterClass : 'Esploratore';
  }

  if (req.body.stats !== undefined) {
    const { forza, agilita, astuzia, coraggio } = req.body.stats;
    for (const v of [forza, agilita, astuzia, coraggio]) {
      if (v !== undefined && (v < 0 || v > 3)) {
        return res.status(400).json({ error: 'Le statistiche devono essere tra 0 e 3.' });
      }
    }
    if (forza !== undefined) updates.forza = forza;
    if (agilita !== undefined) updates.agilita = agilita;
    if (astuzia !== undefined) updates.astuzia = astuzia;
    if (coraggio !== undefined) updates.coraggio = coraggio;
  }

  if (req.body.baseHp !== undefined && Number(req.body.baseHp) > 0) {
    updates.base_hp = Number(req.body.baseHp);
  }
  if (req.body.baseEnergy !== undefined && Number(req.body.baseEnergy) > 0) {
    updates.base_energy = Number(req.body.baseEnergy);
  }

  if (req.body.appearance !== undefined) updates.appearance = sanitizeAppearance(req.body.appearance);

  const { data, error } = await supabaseAdmin
    .from('characters')
    .update(updates)
    .eq('id', id)
    .eq('owner_id', req.user.id)
    .select('*')
    .single();

  if (error) { console.error('[characters] errore modifica:', error); return res.status(500).json({ error: 'Impossibile modificare il personaggio.' }); }
  if (!data) return res.status(404).json({ error: 'Personaggio non trovato.' });
  res.json(data);
});

// DELETE /api/characters/:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabaseAdmin
    .from('characters')
    .delete()
    .eq('id', req.params.id)
    .eq('owner_id', req.user.id);
  if (error) { console.error('[characters] errore eliminazione:', error); return res.status(500).json({ error: 'Impossibile eliminare il personaggio.' }); }
  res.status(204).send();
});

export default router;
