import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import charactersRouter from './routes/characters.js';
import gamesRouter from './routes/games.js';
import actionsRouter from './routes/actions.js';
import npcsRouter from './routes/npcs.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000' }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'gdr-gatti-server' }));

app.use('/api/characters', charactersRouter);
app.use('/api/games', gamesRouter);
// Il loop di gioco vive sotto /api/games/:gameId/action ma in un router dedicato
// per tenere separata la logica "azione" da quella "gestione partita".
app.use('/api/games', actionsRouter);
// CRUD degli NPC (sezione "Configura"), stesso pattern di montaggio degli altri router.
app.use('/api/games', npcsRouter);

// Gestione errori non catturati: non deve MAI trapelare lo stack al client.
app.use((err, req, res, next) => {
  console.error('[server] errore non gestito:', err);
  res.status(500).json({ error: 'Errore interno del server.' });
});

app.listen(PORT, () => {
  console.log(`🐱 GDR dei Gatti — backend in ascolto su http://localhost:${PORT}`);
});
