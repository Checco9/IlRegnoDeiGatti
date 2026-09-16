// =========================================================
// CONFIGURAZIONE DEL CLIENT — va compilata A MANO con i valori veri
// e committata nel repository.
//
// ⚠️ IMPORTANTE: questo file viene servito COSÌ COM'È al browser.
// Le variabili d'ambiente di Netlify/Render NON finiscono qui dentro
// automaticamente: se lasci i valori segnaposto qui sotto, il browser
// proverà a contattare "xxxxxxxx.supabase.co" e fallirà con
// ERR_NAME_NOT_RESOLVED.
//
// La SUPABASE_ANON_KEY è pensata per essere pubblica (è protetta dalle
// Row Level Security del database): è normale e sicuro che stia qui e
// su GitHub. La service_role key invece NON deve MAI stare in questo
// file: quella vive solo nelle variabili d'ambiente del backend.
// =========================================================
window.APP_CONFIG = {
  // Supabase Dashboard -> Project Settings -> API -> Project URL
  SUPABASE_URL: 'https://ddxoklvzobhnzhbajwov.supabase.co',

  // Supabase Dashboard -> Project Settings -> API -> anon public
  SUPABASE_ANON_KEY: 'sb_publishable_lsro_8lTPuaNsHQmbYEOWQ_IN92_YjP',

  // In locale: 'http://localhost:3001/api'
  // Pubblicato:  'https://tuo-backend.onrender.com/api'
  API_BASE_URL: 'https://ilregnodeigatti.onrender.com/api',
};
