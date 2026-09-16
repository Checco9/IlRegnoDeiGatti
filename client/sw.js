// =========================================================
// SERVICE WORKER — solo "app shell": mette in cache i file statici
// (HTML/CSS/JS/icone) così l'app si carica all'istante e può essere
// installata come PWA. NON mette in cache le chiamate API: il gioco
// ha comunque bisogno del backend e di Supabase per funzionare, questo
// serve solo a far apparire l'interfaccia subito, anche con rete lenta.
// =========================================================

const CACHE_NAME = 'gdr-gatti-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './audio.js',
  './config.js',
  './manifest.json',
  './assets/ui/icon-192.png',
  './assets/ui/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {
      // se anche un solo file manca, non blocchiamo l'installazione del service worker
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Mai intercettare le chiamate API o richieste verso altri domini (Supabase,
  // il backend, ecc.): quelle devono sempre passare dalla rete vera.
  if (url.pathname.startsWith('/api/') || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // mette in cache solo risposte valide, per aggiornare l'app shell nel tempo
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
