import { supabaseAuthClient, supabaseAdmin } from '../config/supabase.js';

/**
 * Verifica il JWT di Supabase mandato dal frontend nell'header Authorization.
 * Popola req.user = { id, email }.
 */
export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Token mancante. Effettua il login.' });
    }

    const { data, error } = await supabaseAuthClient.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Sessione non valida o scaduta.' });
    }

    req.user = { id: data.user.id, email: data.user.email };
    next();
  } catch (err) {
    console.error('[auth] errore verifica token:', err);
    res.status(500).json({ error: 'Errore interno durante l\'autenticazione.' });
  }
}

/**
 * Verifica che l'utente autenticato sia membro della partita indicata
 * in req.params.gameId. Da usare DOPO requireAuth.
 */
export async function requireGameMembership(req, res, next) {
  try {
    const gameId = req.params.gameId;
    const { data, error } = await supabaseAdmin
      .from('game_players')
      .select('role')
      .eq('game_id', gameId)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(403).json({ error: 'Non fai parte di questa partita.' });
    }

    req.gameRole = data.role;
    next();
  } catch (err) {
    console.error('[auth] errore verifica appartenenza partita:', err);
    res.status(500).json({ error: 'Errore interno durante il controllo dei permessi.' });
  }
}

/**
 * Verifica che l'utente sia il PROPRIETARIO (il "master") della partita, non
 * un semplice giocatore invitato. Da usare DOPO requireGameMembership, per
 * le azioni riservate a chi ha creato l'avventura: invitare altri giocatori,
 * creare/modificare/eliminare luoghi e NPC in Configura. Senza questo
 * controllo, qualunque giocatore invitato poteva fare tutto ciò che poteva
 * fare il proprietario, inclusa la lettura dei segreti degli NPC pensati
 * per restare visibili solo al master.
 */
export function requireOwner(req, res, next) {
  if (req.gameRole !== 'proprietario') {
    return res.status(403).json({ error: 'Solo chi ha creato la partita può farlo.' });
  }
  next();
}
