// Configurazione del client. La SUPABASE_ANON_KEY è pensata per essere pubblica
// (protetta dalla Row Level Security lato database): non è un segreto.
// Non mettere MAI qui la service_role key o chiavi dell'IA.
window.APP_CONFIG = {
  SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'incolla-qui-la-anon-public-key',
  API_BASE_URL: 'http://localhost:3001/api',
};
