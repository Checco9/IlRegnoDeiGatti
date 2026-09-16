#!/usr/bin/env node
// =========================================================
// AVVIO AUTOMATICO — Il Regno dei Gatti
//
// Cosa fa, in ordine:
//  1. Controlla che server/.env esista (altrimenti lo crea dal modello
//     e si ferma, perché senza le chiavi Supabase non ha senso partire).
//  2. Se server/node_modules manca, esegue "npm install" automaticamente.
//  3. Avvia il backend (npm run dev dentro server/).
//  4. Serve il frontend con un piccolo server statico integrato
//     (nessuna dipendenza esterna, funziona anche offline).
//  5. Apre il browser sulla pagina del gioco.
//  6. Con Ctrl+C chiude entrambi i processi in modo pulito.
//
// Uso: "npm start" dalla cartella principale del progetto
//      (oppure "node start.js").
// =========================================================

import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import { spawn, exec, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = join(__dirname, 'server');
const CLIENT_DIR = join(__dirname, 'client');
const BACKEND_PORT = 3001;
const FRONTEND_PORT = 3000;

const COLORS = { reset: '\x1b[0m', gold: '\x1b[33m', red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m' };
function log(msg, color = 'reset') {
  console.log(`${COLORS[color] || ''}${msg}${COLORS.reset}`);
}

// ---------------------------------------------------------
// 1. server/.env — se manca, lo crea dal modello e si ferma qui.
//    Meglio fermarsi con un messaggio chiaro che partire con
//    chiavi Supabase finte e ottenere errori incomprensibili dopo.
// ---------------------------------------------------------
const envPath = join(SERVER_DIR, '.env');
const envExamplePath = join(SERVER_DIR, '.env.example');

if (!existsSync(envPath)) {
  if (existsSync(envExamplePath)) {
    copyFileSync(envExamplePath, envPath);
    log('\n🐱 Ho creato server/.env a partire dal modello (server/.env.example).', 'gold');
  } else {
    log('\n⚠️  Manca sia server/.env che server/.env.example: qualcosa non torna nella struttura del progetto.', 'red');
  }
  log('   Apri server/.env e inserisci i tuoi valori Supabase reali', 'gold');
  log('   (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY),', 'gold');
  log('   poi rilancia con "npm start".\n', 'gold');
  process.exit(1);
}

// Avviso (non bloccante) se anche il frontend ha ancora i valori segnaposto.
const configPath = join(CLIENT_DIR, 'config.js');
if (existsSync(configPath) && readFileSync(configPath, 'utf8').includes('xxxxxxxx.supabase.co')) {
  log('⚠️  client/config.js contiene ancora i valori segnaposto: il login non funzionerà finché non lo compili con i tuoi dati Supabase.\n', 'gold');
}

// ---------------------------------------------------------
// 2. npm install del backend, solo se non è già stato fatto.
// ---------------------------------------------------------
if (!existsSync(join(SERVER_DIR, 'node_modules'))) {
  log('📦 Prima volta: installo le dipendenze del backend...', 'dim');
  execSync('npm install', { cwd: SERVER_DIR, stdio: 'inherit' });
}

// ---------------------------------------------------------
// 3. Avvia il backend come processo figlio.
// ---------------------------------------------------------
log(`\n🐾 Avvio il backend su http://localhost:${BACKEND_PORT}`, 'green');
const backend = spawn('npm', ['run', 'dev'], { cwd: SERVER_DIR, stdio: 'inherit', shell: true });

backend.on('error', (err) => {
  log(`❌ Impossibile avviare il backend: ${err.message}`, 'red');
});

// ---------------------------------------------------------
// 4. Piccolo server statico per il frontend, senza dipendenze esterne.
// ---------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const staticServer = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = normalize(join(CLIENT_DIR, urlPath === '/' ? 'index.html' : urlPath));

  // sicurezza minima: non uscire mai dalla cartella client/
  if (!filePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403);
    return res.end('Vietato');
  }

  try {
    const data = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('File non trovato: ' + urlPath);
  }
});

staticServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log(`❌ La porta ${FRONTEND_PORT} è già occupata (un altro processo è già in ascolto lì).`, 'red');
  } else {
    log(`❌ Errore nel server del frontend: ${err.message}`, 'red');
  }
});

staticServer.listen(FRONTEND_PORT, () => {
  const url = `http://localhost:${FRONTEND_PORT}`;
  log(`🐱 Frontend servito su ${url}`, 'green');
  log('\n   (Ctrl+C in questa finestra chiude entrambi i server)\n', 'dim');
  setTimeout(() => openBrowser(url), 1200);
});

// ---------------------------------------------------------
// 5. Apre il browser automaticamente sul sistema operativo corrente.
// ---------------------------------------------------------
function openBrowser(url) {
  const platform = process.platform;
  const cmd =
    platform === 'darwin' ? `open "${url}"` :
    platform === 'win32' ? `start "" "${url}"` :
    `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) log(`Apri manualmente il browser su ${url}`, 'dim');
  });
}

// ---------------------------------------------------------
// 6. Chiusura pulita con Ctrl+C: ferma entrambi i processi.
// ---------------------------------------------------------
function shutdown() {
  log('\n👋 Chiudo backend e frontend...', 'dim');
  backend.kill();
  staticServer.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
