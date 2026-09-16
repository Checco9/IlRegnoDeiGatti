import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    '[supabase] Variabili d\'ambiente mancanti. Copia server/.env.example in server/.env e compilalo.'
  );
}

// Client "anon": usato solo per verificare il token JWT dell'utente che arriva dal frontend.
// Rispetta la Row Level Security.
export const supabaseAuthClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Client "service role": usato dal backend per leggere/scrivere lo stato di gioco.
// Bypassa la RLS -> per questo tutte le verifiche di appartenenza alla partita
// (l'utente è un membro di questo game_id?) le facciamo esplicitamente nel codice,
// PRIMA di ogni lettura/scrittura, nel middleware requireGameMembership.
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
