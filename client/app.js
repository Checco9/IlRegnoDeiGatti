// =========================================================
// IL REGNO DEI GATTI — client
// Vanilla JS, nessun build step: apri index.html con un
// piccolo server statico (es. `npx serve client`) o tramite
// l'estensione Live Server, e assicurati che config.js punti
// al tuo progetto Supabase e al backend locale.
// =========================================================

// NOTA: il CDN Supabase espone già un oggetto globale "window.supabase",
// quindi il client va chiamato "supabaseClient" per non sovrascrivere quel namespace.
const supabaseClient = window.supabase.createClient(
  window.APP_CONFIG.SUPABASE_URL,
  window.APP_CONFIG.SUPABASE_ANON_KEY
);

const API_BASE = window.APP_CONFIG.API_BASE_URL;

// Soglie di XP per livello: mirror lato client della stessa costante del backend
// (server/src/services/ruleEngine.js), usata solo per disegnare la barra di progresso.
const XP_THRESHOLDS = { 1: 0, 2: 100, 3: 250, 4: 450, 5: 700 };

const state = {
  session: null,
  characters: [],
  editingCharacterId: null,
  wizard: { title: '', tone: 'avventurosa', characterIds: [] },
  currentGameId: null,
  currentGameState: null,
  activeGameCharacterId: null,
  currentLocations: [],
  editingLocationConfigId: null,
  editingNpcConfigId: null,
  configNpcs: [],
};

// ---------------------------------------------------------
// Navigazione tra schermate
// ---------------------------------------------------------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showAlert(containerId, message, tone = 'error') {
  const el = document.getElementById(containerId);
  if (!message) { el.innerHTML = ''; return; }
  const cls = tone === 'info' ? 'alert alert-info' : 'alert';
  el.innerHTML = `<div class="${cls}">${escapeHtml(message)}</div>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------
// Chiamate al backend (sempre con il token Supabase dell'utente)
// ---------------------------------------------------------
async function apiFetch(path, options = {}) {
  const token = state.session?.access_token;
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
  return data;
}

// ---------------------------------------------------------
// Autenticazione
// ---------------------------------------------------------
document.getElementById('btn-login').addEventListener('click', async () => {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  showAlert('auth-alert', '');
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    state.session = data.session;
    await enterKingdom();
  } catch (err) {
    showAlert('auth-alert', err.message);
  }
});

document.getElementById('btn-signup').addEventListener('click', async () => {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  showAlert('auth-alert', '');
  try {
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) throw error;
    if (data.session) {
      state.session = data.session;
      await enterKingdom();
    } else {
      showAlert('auth-alert', 'Registrazione avvenuta: controlla la tua email per confermare l\'account, poi accedi.', 'info');
    }
  } catch (err) {
    showAlert('auth-alert', err.message);
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  state.session = null;
  showScreen('screen-auth');
});

async function enterKingdom() {
  await loadCharacters();
  document.getElementById('home-games-section').style.display = 'none';
  showScreen('screen-home');
}

// ---------------------------------------------------------
// Home
// ---------------------------------------------------------
document.getElementById('btn-nav-characters').addEventListener('click', async () => {
  resetCharacterForm();
  await loadCharacters();
  showScreen('screen-characters');
});
document.getElementById('btn-characters-back').addEventListener('click', () => {
  resetCharacterForm();
  showScreen('screen-home');
});

document.getElementById('btn-nav-continue').addEventListener('click', async () => {
  const section = document.getElementById('home-games-section');
  section.style.display = 'block';
  const games = await apiFetch('/games');
  const list = document.getElementById('game-list');
  list.innerHTML = '';
  if (!games.length) {
    list.innerHTML = '<p class="field-hint">Non hai ancora nessuna avventura. Creane una nuova!</p>';
    return;
  }
  games.forEach((g) => {
    const div = document.createElement('div');
    div.className = 'game-list-item';
    div.innerHTML = `<div><div class="title">${escapeHtml(g.title)}</div><div class="meta">${g.tone} · ${g.status}</div></div><span>→</span>`;
    div.addEventListener('click', () => openGame(g.id, g.title));
    list.appendChild(div);
  });
});

document.getElementById('btn-nav-new-adventure').addEventListener('click', async () => {
  await loadCharacters();
  resetWizard();
  showScreen('screen-wizard');
});

// ---------------------------------------------------------
// Personaggi
// ---------------------------------------------------------
['forza', 'agilita', 'astuzia', 'coraggio'].forEach((stat) => {
  const input = document.getElementById(`stat-${stat}`);
  const val = document.getElementById(`stat-${stat}-val`);
  input.addEventListener('input', () => { val.textContent = input.value; });
});

async function loadCharacters() {
  state.characters = await apiFetch('/characters');
  renderCharacterList();
}

/** Piccolo helper riusabile: medaglione con immagine se presente, altrimenti iniziale. */
function avatarInnerHtml(name, url) {
  return url
    ? `<img src="${escapeAttr(url)}" alt="${escapeAttr(name)}" onerror="this.parentElement.textContent='${escapeAttr((name || '?')[0])}'">`
    : escapeHtml((name || '?')[0]);
}

// =========================================================
// FASE 3 — aspetto a "livelli" del gatto (senza asset grafici reali):
// pelo → sfondo del medaglione, occhi → puntino colorato, vestiti → colore
// del bordo, arma/accessorio → piccoli distintivi agli angoli. Quando esiste
// un'immagine reale (avatar_url) quella ha sempre la priorità.
// =========================================================
const FUR_COLORS = {
  arancione: '#c9812f',
  nero: '#2b2b2b',
  bianco: '#e8e2d0',
  grigio: '#8a8a8a',
  soriano: '#a9793f',
  calico: 'linear-gradient(135deg, #c9812f 33%, #2b2b2b 33% 66%, #e8e2d0 66%)',
};
const EYE_COLORS = {
  verde: '#5bbf7a', blu: '#4a8fd6', ambra: '#d68a2c', giallo: '#d9c93a',
  eterocromia: 'linear-gradient(90deg, #4a8fd6 50%, #d68a2c 50%)',
};
const CLOTHES_BORDER = { armatura: '#7a7a7a', mantello: '#4a2f6d', pirata: '#2b2b2b', tunica: '#c9a227' };
const WEAPON_ICONS = { spada: '⚔️', pugnale: '🗡️', bastone: '🪄', arco: '🏹' };
const ACCESSORY_ICONS = { campanellino: '🔔', benda: '🩹', cappello: '🎩', mantellina: '👑' };

/**
 * Configura un elemento medaglione già presente nel DOM (span.medallion o
 * span.figure-avatar): immagine reale > aspetto a livelli > iniziale.
 * Muta l'elemento passato, non restituisce una stringa, perché il pelo va
 * applicato come sfondo dell'elemento stesso, non come contenuto interno.
 */
function applyCatAppearance(el, { name, avatarUrl, appearance }) {
  el.innerHTML = '';
  el.style.background = '';
  el.style.borderColor = '';

  if (avatarUrl) {
    el.innerHTML = avatarInnerHtml(name, avatarUrl);
    return;
  }

  const a = appearance || {};
  const hasCustomLook = ['fur', 'eyes', 'clothes', 'weapon', 'accessory'].some((k) => a[k] && a[k] !== 'nessuno');
  if (!hasCustomLook) {
    el.textContent = (name || '?')[0];
    return;
  }

  if (FUR_COLORS[a.fur]) el.style.background = FUR_COLORS[a.fur];
  if (CLOTHES_BORDER[a.clothes]) el.style.borderColor = CLOTHES_BORDER[a.clothes];

  if (EYE_COLORS[a.eyes]) {
    const eye = document.createElement('span');
    eye.className = 'cat-eye-dot';
    eye.style.background = EYE_COLORS[a.eyes];
    el.appendChild(eye);
  }
  if (WEAPON_ICONS[a.weapon]) {
    const badge = document.createElement('span');
    badge.className = 'cat-badge cat-badge-weapon';
    badge.textContent = WEAPON_ICONS[a.weapon];
    el.appendChild(badge);
  }
  if (ACCESSORY_ICONS[a.accessory]) {
    const badge = document.createElement('span');
    badge.className = 'cat-badge cat-badge-accessory';
    badge.textContent = ACCESSORY_ICONS[a.accessory];
    el.appendChild(badge);
  }
}

function readAppearanceForm() {
  return {
    fur: document.getElementById('char-fur').value,
    eyes: document.getElementById('char-eyes').value,
    clothes: document.getElementById('char-clothes').value,
    weapon: document.getElementById('char-weapon').value,
    accessory: document.getElementById('char-accessory').value,
  };
}

function updateAppearancePreview() {
  const preview = document.getElementById('char-appearance-preview');
  applyCatAppearance(preview, {
    name: document.getElementById('char-name').value || '?',
    avatarUrl: document.getElementById('char-avatar').value.trim(),
    appearance: readAppearanceForm(),
  });
}

['char-name', 'char-avatar'].forEach((id) => {
  document.getElementById(id).addEventListener('input', updateAppearancePreview);
});
['char-fur', 'char-eyes', 'char-clothes', 'char-weapon', 'char-accessory'].forEach((id) => {
  document.getElementById(id).addEventListener('change', updateAppearancePreview);
});
updateAppearancePreview();

function renderCharacterList() {
  const list = document.getElementById('character-list');
  list.innerHTML = '';
  if (!state.characters.length) {
    list.innerHTML = '<p class="field-hint">Non hai ancora creato nessun gatto.</p>';
    return;
  }
  state.characters.forEach((c) => {
    const div = document.createElement('div');
    div.className = 'game-list-item';
    div.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <span class="medallion" data-avatar></span>
        <div>
          <div class="title">${escapeHtml(c.name)} — ${escapeHtml(c.class)}</div>
          <div class="meta">HP ${c.base_hp} · For ${c.forza} Agi ${c.agilita} Ast ${c.astuzia} Cor ${c.coraggio}</div>
        </div>
      </div>`;
    applyCatAppearance(div.querySelector('[data-avatar]'), { name: c.name, avatarUrl: c.avatar_url, appearance: c.appearance });
    div.style.cursor = 'pointer';
    if (c.id === state.editingCharacterId) div.style.borderColor = 'var(--gold)';
    div.addEventListener('click', () => startEditCharacter(c));
    list.appendChild(div);
  });
}

/** Suggerimento (non vincolante) di energia massima in base alla classe scelta. */
const CLASS_ENERGY_SUGGESTION = {
  Mago: 30, Bardo: 20, Paladino: 15, Ladro: 15, Esploratore: 15,
  Guerriero: 10, Divoratore: 10, 'Gatto Pigro': 5,
};
document.getElementById('char-class').addEventListener('change', (e) => {
  document.getElementById('char-energy').value = CLASS_ENERGY_SUGGESTION[e.target.value] ?? 10;
});

/** Carica un personaggio già esistente nel form, per modificarlo. */
function startEditCharacter(c) {
  state.editingCharacterId = c.id;

  document.getElementById('char-name').value = c.name || '';
  document.getElementById('char-avatar').value = c.avatar_url || '';
  document.getElementById('char-desc').value = c.description || '';
  document.getElementById('char-personality').value = c.personality || '';
  document.getElementById('char-class').value = c.class || 'Esploratore';
  document.getElementById('char-hp').value = c.base_hp || 20;
  document.getElementById('char-energy').value = c.base_energy || 10;

  ['forza', 'agilita', 'astuzia', 'coraggio'].forEach((stat) => {
    const value = c[stat] ?? 1;
    document.getElementById(`stat-${stat}`).value = value;
    document.getElementById(`stat-${stat}-val`).textContent = value;
  });

  const a = c.appearance || {};
  if (a.fur) document.getElementById('char-fur').value = a.fur;
  if (a.eyes) document.getElementById('char-eyes').value = a.eyes;
  document.getElementById('char-clothes').value = a.clothes || 'nessuno';
  document.getElementById('char-weapon').value = a.weapon || 'nessuno';
  document.getElementById('char-accessory').value = a.accessory || 'nessuno';
  updateAppearancePreview();

  document.getElementById('character-form-title').textContent = `Modifica ${c.name}`;
  document.getElementById('btn-save-character').textContent = 'Salva modifiche';
  document.getElementById('btn-cancel-edit-character').style.display = 'inline-block';
  showAlert('char-alert', '');
  renderCharacterList();
  document.getElementById('character-form-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetCharacterForm() {
  state.editingCharacterId = null;
  document.getElementById('char-name').value = '';
  document.getElementById('char-avatar').value = '';
  document.getElementById('char-desc').value = '';
  document.getElementById('char-personality').value = '';
  document.getElementById('char-class').value = 'Esploratore';
  document.getElementById('char-hp').value = 20;
  document.getElementById('char-energy').value = 10;
  ['forza', 'agilita', 'astuzia', 'coraggio'].forEach((stat) => {
    document.getElementById(`stat-${stat}`).value = 1;
    document.getElementById(`stat-${stat}-val`).textContent = 1;
  });
  document.getElementById('char-clothes').value = 'nessuno';
  document.getElementById('char-weapon').value = 'nessuno';
  document.getElementById('char-accessory').value = 'nessuno';
  updateAppearancePreview();

  document.getElementById('character-form-title').textContent = 'Crea un nuovo gatto';
  document.getElementById('btn-save-character').textContent = 'Salva personaggio';
  document.getElementById('btn-cancel-edit-character').style.display = 'none';
  showAlert('char-alert', '');
}

document.getElementById('btn-cancel-edit-character').addEventListener('click', () => {
  resetCharacterForm();
  renderCharacterList();
});

document.getElementById('btn-save-character').addEventListener('click', async () => {
  showAlert('char-alert', '');
  const name = document.getElementById('char-name').value.trim();
  if (!name) return showAlert('char-alert', 'Dai un nome al tuo gatto.');

  const payload = {
    name,
    avatarUrl: document.getElementById('char-avatar').value.trim() || null,
    description: document.getElementById('char-desc').value.trim(),
    personality: document.getElementById('char-personality').value.trim(),
    characterClass: document.getElementById('char-class').value,
    stats: {
      forza: Number(document.getElementById('stat-forza').value),
      agilita: Number(document.getElementById('stat-agilita').value),
      astuzia: Number(document.getElementById('stat-astuzia').value),
      coraggio: Number(document.getElementById('stat-coraggio').value),
    },
    baseHp: Number(document.getElementById('char-hp').value) || 20,
    baseEnergy: Number(document.getElementById('char-energy').value) || 10,
    appearance: readAppearanceForm(),
  };

  try {
    if (state.editingCharacterId) {
      await apiFetch(`/characters/${state.editingCharacterId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await apiFetch('/characters', { method: 'POST', body: JSON.stringify(payload) });
    }
    resetCharacterForm();
    await loadCharacters();
  } catch (err) {
    showAlert('char-alert', err.message);
  }
});

// ---------------------------------------------------------
// Wizard nuova avventura
// ---------------------------------------------------------
function resetWizard() {
  state.wizard = { title: '', tone: 'avventurosa', characterIds: [] };
  document.getElementById('wizard-title').value = '';
  document.querySelectorAll('.tone-option').forEach((el) => el.classList.remove('selected'));
  document.querySelector('.tone-option[data-tone="avventurosa"]').classList.add('selected');
  showWizardStep(1);
  showAlert('wizard-alert', '');
}

function showWizardStep(n) {
  [1, 2, 3].forEach((i) => {
    document.getElementById(`wizard-step-${i}`).style.display = i === n ? 'block' : 'none';
    document.getElementById(`wdot-${i}`).classList.toggle('done', i <= n);
  });
}

document.getElementById('btn-wizard-back').addEventListener('click', () => showScreen('screen-home'));

document.getElementById('btn-wizard-next-1').addEventListener('click', () => {
  const title = document.getElementById('wizard-title').value.trim();
  if (!title) return showAlert('wizard-alert', 'Dai un nome alla tua avventura.');
  state.wizard.title = title;
  showAlert('wizard-alert', '');
  showWizardStep(2);
});

document.getElementById('btn-wizard-back-2').addEventListener('click', () => showWizardStep(1));

document.getElementById('tone-grid').addEventListener('click', (e) => {
  const option = e.target.closest('.tone-option');
  if (!option) return;
  document.querySelectorAll('.tone-option').forEach((el) => el.classList.remove('selected'));
  option.classList.add('selected');
  state.wizard.tone = option.dataset.tone;
});

document.getElementById('btn-wizard-next-2').addEventListener('click', () => {
  renderWizardCharacterList();
  showWizardStep(3);
});

document.getElementById('btn-wizard-back-3').addEventListener('click', () => showWizardStep(2));

function renderWizardCharacterList() {
  const list = document.getElementById('wizard-char-list');
  list.innerHTML = '';
  if (!state.characters.length) {
    list.innerHTML = '<p class="field-hint">Non hai personaggi: torna alla corte e creane uno prima di iniziare.</p>';
    return;
  }
  state.characters.forEach((c) => {
    const div = document.createElement('div');
    div.className = 'char-pick-item';
    div.innerHTML = `<span class="medallion">${escapeHtml(c.name[0])}</span><div><div class="name" style="font-family:var(--font-display);">${escapeHtml(c.name)}</div><div class="field-hint">${escapeHtml(c.class)}</div></div>`;
    div.addEventListener('click', () => {
      const idx = state.wizard.characterIds.indexOf(c.id);
      if (idx >= 0) { state.wizard.characterIds.splice(idx, 1); div.classList.remove('selected'); }
      else { state.wizard.characterIds.push(c.id); div.classList.add('selected'); }
    });
    list.appendChild(div);
  });
}

document.getElementById('btn-wizard-start').addEventListener('click', async () => {
  if (!state.wizard.characterIds.length) return showAlert('wizard-alert', 'Scegli almeno un gatto.');
  showAlert('wizard-alert', '');
  const btn = document.getElementById('btn-wizard-start');
  btn.disabled = true;
  btn.textContent = 'Il destino si scrive...';
  try {
    const result = await apiFetch('/games', {
      method: 'POST',
      body: JSON.stringify({
        title: state.wizard.title,
        tone: state.wizard.tone,
        characterIds: state.wizard.characterIds,
      }),
    });
    await openGame(result.game.id, result.game.title, result.promptText);
  } catch (err) {
    showAlert('wizard-alert', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Inizia avventura';
  }
});

// ---------------------------------------------------------
// Schermata di gioco
// ---------------------------------------------------------
document.getElementById('btn-game-back').addEventListener('click', () => {
  window.audioEngine.stopAmbient();
  showScreen('screen-home');
});

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

async function openGame(gameId, title, initialPromptText = null) {
  state.currentGameId = gameId;
  state.lastPromptText = null;
  document.getElementById('game-title').innerHTML = `<span class="crown-mark">♛</span> ${escapeHtml(title)}`;
  showScreen('screen-game');

  document.getElementById('d20-shape').classList.remove('result-success', 'result-failure', 'result-crit-success', 'result-crit-failure', 'spinning');
  document.getElementById('d20-number').textContent = '20';
  document.getElementById('roll-outcome-label').textContent = '';
  document.getElementById('roll-result').innerHTML = '';

  const story = document.getElementById('story-parchment');
  story.innerHTML = '<div class="spinner-line">Si sfoglia la pergamena...</div>';

  const gameState = await apiFetch(`/games/${gameId}`);
  state.currentGameState = gameState;
  state.activeGameCharacterId = gameState.personaggi[0]?.game_character_id || null;

  renderStoryFromState(gameState);
  renderRoster(gameState);
  renderScene(gameState);
  renderFameBadge(gameState);
  document.getElementById('minimap-panel').style.display = 'none';
  populateRollCharacterSelect(gameState);
  window.audioEngine.setAmbientMode(gameState.scena_corrente || 'esplorazione');
  window.audioEngine.startAmbient(gameState.scena_corrente || 'esplorazione');

  if (initialPromptText) {
    appendCopyChip('La pergamena è ancora bianca: copia questo testo e incollalo nella tua IA per generare l\'apertura dell\'avventura.', initialPromptText);
  }
}

function renderStoryFromState(gameState) {
  const story = document.getElementById('story-parchment');
  story.innerHTML = '';
  if (gameState.riassunto_precedente) {
    appendStoryEntry(`Capitolo ${gameState.riassunto_precedente.capitolo} — ${gameState.riassunto_precedente.titolo}: ${gameState.riassunto_precedente.riassunto}`, 'summary');
  }
  (gameState.eventi_recenti || []).forEach((e) => {
    const cls = e.tipo === 'player_action' ? 'player' : e.tipo === 'dice_roll' ? 'roll' : e.tipo === 'ai_narration' ? '' : 'roll';
    appendStoryEntry(e.testo, cls);
  });
  if (!gameState.eventi_recenti?.length && !gameState.riassunto_precedente) {
    appendStoryEntry('La pergamena è ancora bianca. Scrivete la prima mossa.', '');
  }
}

function appendStoryEntry(text, cls = '') {
  const story = document.getElementById('story-parchment');
  const div = document.createElement('div');
  div.className = `story-entry ${cls}`;
  div.textContent = text;
  story.appendChild(div);
  story.scrollTop = story.scrollHeight;
}

/** Riga della pergamena con un pulsante per copiare un testo pronto (usato per l'apertura). */
function appendCopyChip(label, textToCopy) {
  const story = document.getElementById('story-parchment');
  const div = document.createElement('div');
  div.className = 'story-entry';
  const p = document.createElement('div');
  p.textContent = label;
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.style.marginTop = '8px';
  btn.textContent = '📋 Copia questo testo';
  btn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(textToCopy);
    window.audioEngine.playPageTurn();
    btn.textContent = '✓ Copiato!';
    setTimeout(() => { btn.textContent = '📋 Copia questo testo'; }, 1800);
  });
  div.appendChild(p);
  div.appendChild(btn);
  story.appendChild(div);
  story.scrollTop = story.scrollHeight;
}

/** Fama del gruppo: badge nell'intestazione, con una sfumatura di colore in base al valore. */
function renderFameBadge(gameState) {
  const value = gameState.fama ?? 0;
  const el = document.getElementById('fame-value');
  const badge = document.getElementById('fame-badge');
  el.textContent = value;
  badge.classList.toggle('fame-good', value >= 25);
  badge.classList.toggle('fame-bad', value <= -25);
}

function renderRoster(gameState) {
  const strip = document.getElementById('roster-strip');
  strip.innerHTML = '';
  gameState.personaggi.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'roster-card';
    const [cur, max] = p.hp.split('/').map(Number);
    const low = cur <= max * 0.3;
    card.innerHTML = `
      <span class="medallion" data-avatar></span>
      <div class="roster-info">
        <div class="name">${escapeHtml(p.nome)}</div>
        <div class="hp ${low ? 'low' : ''}">❤ ${p.hp} · 🎒 ${p.inventario.length}</div>
      </div>`;
    applyCatAppearance(card.querySelector('[data-avatar]'), { name: p.nome, avatarUrl: p.avatar, appearance: p.aspetto });
    card.style.cursor = 'pointer';
    card.style.opacity = p.game_character_id === state.activeGameCharacterId ? '1' : '0.55';
    card.title = 'Clicca per rendere questo gatto protagonista della prossima azione';
    card.addEventListener('click', () => {
      state.activeGameCharacterId = p.game_character_id;
      document.getElementById('roll-character').value = p.game_character_id;
      renderRoster(state.currentGameState);
    });
    strip.appendChild(card);
  });
}

/**
 * FASE 1-2: scena visiva. Sfondo del luogo (immagine se presente, altrimenti
 * una sfumatura scelta in base al nome del luogo) + personaggi e NPC rilevanti
 * mostrati come medaglioni sul palco. Non sostituisce la narrazione testuale,
 * la affianca soltanto.
 */
const SCENE_MOOD_KEYWORDS = [
  { match: /foresta|bosco/i, gradient: 'linear-gradient(160deg, #16241a, #2a3d24)' },
  { match: /castello|trono|reggia|corte/i, gradient: 'linear-gradient(160deg, #241531, #3a2350)' },
  { match: /grotta|caverna|miniera/i, gradient: 'linear-gradient(160deg, #14141a, #2b2b33)' },
  { match: /palude|pantano/i, gradient: 'linear-gradient(160deg, #1c2418, #33402a)' },
  { match: /montagna|vetta|picco/i, gradient: 'linear-gradient(160deg, #17202b, #2c3f52)' },
  { match: /villaggio|taverna|mercato/i, gradient: 'linear-gradient(160deg, #2e2013, #4a3620)' },
  { match: /battaglia|rovine|campo/i, gradient: 'linear-gradient(160deg, #241014, #4a1c26)' },
];

function guessSceneBackground(locationName) {
  const found = SCENE_MOOD_KEYWORDS.find((m) => m.match.test(locationName || ''));
  return found ? found.gradient : 'linear-gradient(160deg, var(--void), var(--plum))';
}

function renderScene(gameState) {
  const stage = document.getElementById('scene-stage');
  const label = document.getElementById('scene-location-label');
  const figures = document.getElementById('scene-figures');

  const location = gameState.luogo_corrente;
  label.textContent = location ? location.nome : '';

  stage.style.backgroundImage = location?.immagine
    ? `url("${location.immagine}")`
    : guessSceneBackground(location?.nome);

  figures.innerHTML = '';
  hideSceneInfoPanel();

  let i = 0;
  gameState.personaggi.forEach((p) => {
    figures.appendChild(sceneFigureNode({ name: p.nome, avatarUrl: p.avatar, isHostile: false, appearance: p.aspetto, delayIndex: i++ }));
  });
  (gameState.npc_presenti || [])
    .filter((n) => n.rilevante_in_scena)
    .forEach((n) => {
      figures.appendChild(sceneFigureNode({
        name: n.nome,
        avatarUrl: n.avatar,
        isHostile: n.ostile,
        appearance: null,
        delayIndex: i++,
        info: { descrizione: n.descrizione, relazione: n.relazione, hp: n.hp },
      }));
    });

  stage.classList.remove('scene-fade-in');
  // forza il reflow così l'animazione riparte anche se la classe era già stata rimossa
  void stage.offsetWidth;
  stage.classList.add('scene-fade-in');
}

function sceneFigureNode({ name, avatarUrl, isHostile, appearance, delayIndex = 0, info = null }) {
  const el = document.createElement('div');
  el.className = `scene-figure ${isHostile ? 'hostile' : ''}`;
  el.style.animationDelay = `${Math.min(delayIndex, 6) * 0.08}s`;
  el.innerHTML = `
    <span class="figure-avatar" data-avatar></span>
    <span class="figure-name">${escapeHtml(name)}</span>`;
  applyCatAppearance(el.querySelector('[data-avatar]'), { name, avatarUrl, appearance });

  // FASE 4: gli NPC "rilevanti" mostrano una piccola scheda al click
  if (info) {
    el.style.cursor = 'pointer';
    el.title = 'Clicca per i dettagli';
    el.addEventListener('click', () => showSceneInfoPanel(name, info));
  }
  return el;
}

function showSceneInfoPanel(name, info) {
  const panel = document.getElementById('scene-info-panel');
  const parts = [`<strong>${escapeHtml(name)}</strong>`];
  if (info.hp) parts.push(`❤ ${escapeHtml(info.hp)}`);
  if (info.descrizione) parts.push(escapeHtml(info.descrizione));
  if (info.relazione) parts.push(`<em>Relazione: ${escapeHtml(info.relazione)}</em>`);
  panel.innerHTML = parts.map((p) => `<div>${p}</div>`).join('');
  panel.style.display = 'block';
}

function hideSceneInfoPanel() {
  const panel = document.getElementById('scene-info-panel');
  panel.style.display = 'none';
  panel.innerHTML = '';
}

// ---------------------------------------------------------
// FASE 5 — minimappa: non tattica, riusa gli stessi dati di /locations
// già usati dal modal "🗺️ Mappa". Mostra il luogo attuale, i collegamenti
// diretti (cliccabili per viaggiare) e gli altri luoghi scoperti.
// I luoghi con discovered=false compaiono come "???".
// ---------------------------------------------------------
document.getElementById('btn-toggle-minimap').addEventListener('click', async () => {
  const panel = document.getElementById('minimap-panel');
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? 'block' : 'none';
  if (opening) await refreshMinimap();
});

async function refreshMinimap() {
  const panel = document.getElementById('minimap-panel');
  if (panel.style.display === 'none') return; // pannello chiuso: non serve aggiornarlo
  try {
    const locations = await apiFetch(`/games/${state.currentGameId}/locations`);
    renderMinimap(locations);
  } catch (err) {
    document.getElementById('minimap-connections').innerHTML = `<span class="field-hint">${escapeHtml(err.message)}</span>`;
  }
}

function renderMinimap(locations) {
  const currentName = state.currentGameState?.luogo_corrente?.nome;
  const current = locations.find((l) => l.name === currentName);

  document.getElementById('minimap-current-name').textContent = currentName || 'Luogo sconosciuto';

  const connWrap = document.getElementById('minimap-connections');
  connWrap.innerHTML = '';
  const nameById = Object.fromEntries(locations.map((l) => [l.id, l]));
  const connectedIds = new Set((current?.connections || []).map((c) => c.to));

  if (!current || !connectedIds.size) {
    connWrap.innerHTML = '<span class="field-hint">Nessun collegamento noto da qui.</span>';
  } else {
    [...connectedIds].forEach((id) => {
      const loc = nameById[id];
      if (!loc) return;
      const chip = document.createElement('button');
      chip.className = 'btn-quiet minimap-chip';
      const locked = isFameLocked(loc);
      chip.textContent = loc.discovered === false ? '❓ ???' : `${locked ? '🔒' : '🐾'} ${loc.name}`;
      if (loc.discovered !== false && !locked) {
        chip.addEventListener('click', () => travelToLocationId(loc.id));
      } else {
        chip.disabled = true;
        chip.title = locked ? `Serve fama ${loc.min_fame} (ora avete ${state.currentGameState?.fama ?? 0})` : 'Luogo non ancora scoperto';
      }
      connWrap.appendChild(chip);
    });
  }

  const othersWrap = document.getElementById('minimap-others');
  const others = locations.filter((l) => l.id !== current?.id && !connectedIds.has(l.id) && l.discovered !== false);
  othersWrap.textContent = others.length ? `Altri luoghi scoperti: ${others.map((l) => l.name).join(', ')}` : '';
}

// ---------------------------------------------------------
// FASE 6 — piccoli overlay temporanei per eventi importanti.
// Non bloccano il gioco: appaiono per un paio di secondi e scompaiono.
// ---------------------------------------------------------
function showEventOverlay(text) {
  const layer = document.getElementById('scene-event-overlay-layer');
  const banner = document.createElement('div');
  banner.className = 'scene-event-banner';
  banner.textContent = text;
  layer.appendChild(banner);
  setTimeout(() => banner.classList.add('scene-event-banner-out'), 1800);
  setTimeout(() => banner.remove(), 2300);
}

/** Analizza le modifiche appena applicate e mostra gli overlay pertinenti. */
function triggerEventOverlaysForChanges(changes) {
  changes.forEach((c) => {
    if (!c.valid) return;
    if (c.type === 'position' && !c.payload.existingLocationId) {
      showEventOverlay(`✦ LUOGO SCOPERTO: ${c.payload.targetName} ✦`);
    }
    if (c.type === 'quest' && c.payload.isNew) {
      showEventOverlay(`👑 NUOVO INCARICO: ${c.payload.title}`);
    }
    if (c.type === 'npc') {
      showEventOverlay(`✦ NUOVO PERSONAGGIO: ${c.payload.name} ✦`);
    }
    if (c.type === 'enemy') {
      showEventOverlay(`⚔ NEMICO: ${c.payload.name} ⚔`);
    }
    if (c.type === 'scene' && c.payload.sceneType === 'boss') {
      showEventOverlay('⚔ SCONTRO EPICO ⚔');
    }
  });
}

function populateRollCharacterSelect(gameState) {
  const select = document.getElementById('roll-character');
  select.innerHTML = gameState.personaggi
    .map((p) => `<option value="${p.game_character_id}">${escapeHtml(p.nome)}</option>`)
    .join('');
  if (state.activeGameCharacterId) select.value = state.activeGameCharacterId;
}

// ---- dado animato: rotola con numeri casuali, poi si ferma sul risultato vero ----
let diceAnimationTimer = null;

// ---- tira il dado (il PROGRAMMA tira, non l'IA) — libero: il testo è facoltativo ----
document.getElementById('btn-roll-dice').addEventListener('click', async () => {
  const input = document.getElementById('action-input');
  const text = input.value.trim();
  showAlert('action-alert', '');

  const gameCharacterId = document.getElementById('roll-character').value;
  const stat = document.getElementById('roll-stat').value;
  const difficulty = document.getElementById('roll-difficulty').value;

  window.audioEngine.playDiceRoll();
  const btn = document.getElementById('btn-roll-dice');
  btn.disabled = true;
  document.getElementById('roll-result').innerHTML = '';

  // avvia subito l'animazione (rotola mentre aspettiamo la risposta reale dal server)
  const shape = document.getElementById('d20-shape');
  shape.classList.remove('result-success', 'result-failure', 'result-crit-success', 'result-crit-failure');
  shape.classList.add('spinning');
  if (diceAnimationTimer) clearInterval(diceAnimationTimer);
  const numberEl = document.getElementById('d20-number');
  diceAnimationTimer = setInterval(() => { numberEl.textContent = 1 + Math.floor(Math.random() * 20); }, 55);

  try {
    const [result] = await Promise.all([
      apiFetch(`/games/${state.currentGameId}/roll`, {
        method: 'POST',
        body: JSON.stringify({ text, gameCharacterId, stat, difficulty }),
      }),
      new Promise((r) => setTimeout(r, 700)), // durata minima dell'animazione, anche se la rete è velocissima
    ]);
    state.lastPromptText = result.promptText;

    clearInterval(diceAnimationTimer);
    diceAnimationTimer = null;
    shape.classList.remove('spinning');
    numberEl.textContent = result.roll.roll; // il dado mostra il valore GREZZO (1-20), non il totale con bonus

    const outcomeClass = result.roll.criticalSuccess ? 'result-crit-success'
      : result.roll.criticalFailure ? 'result-crit-failure'
      : result.roll.success ? 'result-success' : 'result-failure';
    shape.classList.add(outcomeClass);

    const outcomeLabel = document.getElementById('roll-outcome-label');
    outcomeLabel.textContent = result.roll.criticalSuccess ? '✨ CRITICO!'
      : result.roll.criticalFailure ? '💥 FALLIMENTO CRITICO'
      : result.roll.success ? '✓ Successo' : '✗ Fallimento';

    if (text) appendStoryEntry(text, 'player');
    appendStoryEntry(
      `Prova di ${capitalize(stat)}: ${result.roll.roll} + ${result.roll.statValue} = ${result.roll.total} contro difficoltà ${result.roll.difficulty}`,
      'roll'
    );

    const resultDiv = document.getElementById('roll-result');
    const cls = result.roll.success ? 'success' : 'failure';
    const label = result.roll.success ? '✓ SUCCESSO' : '✗ FALLIMENTO';
    resultDiv.innerHTML = `<span class="${cls}">${label}</span> (tiro ${result.roll.roll}) — scrivi all'IA o premi "Copia per l'IA".`;

    setTimeout(() => {
      if (result.roll.criticalSuccess || result.roll.success) window.audioEngine.playSuccess();
      else window.audioEngine.playFailure();
    }, 150);
  } catch (err) {
    clearInterval(diceAnimationTimer);
    diceAnimationTimer = null;
    shape.classList.remove('spinning');
    showAlert('action-alert', err.message);
  } finally {
    btn.disabled = false;
  }
});

// ---- copia per l'IA ----
document.getElementById('btn-copy-prompt').addEventListener('click', async () => {
  showAlert('action-alert', '');

  try {
    let promptText = state.lastPromptText;

    if (!promptText) {
      const input = document.getElementById('action-input');
      const text = input.value.trim();
      if (!text) return showAlert('action-alert', 'Scrivi cosa volete fare, oppure tira prima il dado.');
      const result = await apiFetch(`/games/${state.currentGameId}/action-only`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      promptText = result.promptText;
      appendStoryEntry(text, 'player');
    }

    await navigator.clipboard.writeText(promptText);
    window.audioEngine.playPageTurn();

    // reset del pannello per la prossima azione
    document.getElementById('action-input').value = '';
    document.getElementById('roll-result').innerHTML = '';
    document.getElementById('roll-outcome-label').textContent = '';
    document.getElementById('d20-shape').classList.remove('result-success', 'result-failure', 'result-crit-success', 'result-crit-failure');
    state.lastPromptText = null;

    showAlert('action-alert', 'Copiato! Incollalo nella tua IA, poi torna qui e incolla la sua risposta qui sotto.', 'info');
  } catch (err) {
    showAlert('action-alert', err.message);
  }
});

document.getElementById('action-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); document.getElementById('btn-copy-prompt').click(); }
});

// ---- importa la risposta dell'IA ----
document.getElementById('btn-toggle-import').addEventListener('click', () => {
  const body = document.getElementById('import-body');
  body.style.display = body.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('btn-analyze-import').addEventListener('click', async () => {
  const rawText = document.getElementById('import-textarea').value;
  const preview = document.getElementById('import-preview');
  if (!rawText.trim()) return;

  preview.innerHTML = '<p class="field-hint">Si analizza il testo...</p>';
  try {
    const result = await apiFetch(`/games/${state.currentGameId}/parse-changes`, {
      method: 'POST',
      body: JSON.stringify({ rawText }),
    });
    renderImportPreview(result);
  } catch (err) {
    preview.innerHTML = `<div class="alert">${escapeHtml(err.message)}</div>`;
  }
});

function renderImportPreview(result) {
  const preview = document.getElementById('import-preview');
  preview.innerHTML = '';

  if (result.narration) {
    const n = document.createElement('div');
    n.className = 'import-narration';
    n.textContent = result.narration;
    preview.appendChild(n);
  }

  const list = document.createElement('div');
  list.className = 'change-list';
  if (!result.changes.length) {
    list.innerHTML = '<p class="field-hint">Nessuna modifica riconosciuta nel testo.</p>';
  } else {
    result.changes.forEach((c) => {
      const row = document.createElement('div');
      row.className = `change-row ${c.valid ? '' : 'invalid'}`;
      row.textContent = c.description;
      list.appendChild(row);
    });
  }
  preview.appendChild(list);

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '10px';
  actions.style.marginTop = '10px';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'Annulla';
  cancelBtn.addEventListener('click', () => {
    preview.innerHTML = '';
    document.getElementById('import-textarea').value = '';
  });

  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn btn-primary';
  applyBtn.textContent = 'Applica';
  applyBtn.addEventListener('click', async () => {
    applyBtn.disabled = true;
    try {
      const applied = await apiFetch(`/games/${state.currentGameId}/apply-changes`, {
        method: 'POST',
        body: JSON.stringify({ narration: result.narration, changes: result.changes }),
      });

      if (result.narration) appendStoryEntry(result.narration, '');
      result.changes.filter((c) => c.valid).forEach((c) => appendStoryEntry(c.description, 'roll'));

      window.audioEngine.playPageTurn();
      if (result.changes.some((c) => c.type === 'position' && c.valid)) window.audioEngine.playDoorCreak();
      if (result.changes.some((c) => c.type === 'item_add' && c.valid)) setTimeout(() => window.audioEngine.playBell(), 300);
      triggerEventOverlaysForChanges(result.changes);

      const beforeState = state.currentGameState;
      state.currentGameState = applied.stato;
      renderRoster(state.currentGameState);
      renderScene(state.currentGameState);
      renderFameBadge(state.currentGameState);
      populateRollCharacterSelect(state.currentGameState);
      window.audioEngine.setAmbientMode(state.currentGameState.scena_corrente || 'esplorazione');
      await refreshMinimap();

      // se qualche personaggio è appena salito di livello, apri subito la pagina di assegnazione
      const leveledUp = state.currentGameState.personaggi.find((p) => {
        const before = beforeState.personaggi.find((b) => b.game_character_id === p.game_character_id);
        return before && p.punti_abilita_da_assegnare > before.punti_abilita_da_assegnare;
      });
      if (leveledUp) {
        showEventOverlay(`🎉 ${leveledUp.nome} sale di livello!`);
        openLevelUpModal(leveledUp);
      }

      document.getElementById('import-textarea').value = '';
      preview.innerHTML = '';
      document.getElementById('import-body').style.display = 'none';
    } catch (err) {
      preview.innerHTML += `<div class="alert">${escapeHtml(err.message)}</div>`;
    } finally {
      applyBtn.disabled = false;
    }
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(applyBtn);
  preview.appendChild(actions);
}

// ---------------------------------------------------------
// Modali: mappa (modificabile), sacca, cronaca, audio
// ---------------------------------------------------------
document.querySelectorAll('[data-close-modal]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.getElementById(btn.dataset.closeModal).classList.remove('active');
  });
});

document.getElementById('btn-copy-state').addEventListener('click', async () => {
  try {
    const result = await apiFetch(`/games/${state.currentGameId}/copy-state`);
    await navigator.clipboard.writeText(result.promptText);
    window.audioEngine.playPageTurn();
    showAlert('action-alert', 'Stato copiato negli appunti.', 'info');
  } catch (err) {
    showAlert('action-alert', err.message);
  }
});

// "Istruisci l'IA": utilizzabile in qualsiasi momento, non solo all'inizio —
// utile per una nuova chat con l'IA a metà partita, o se ha smesso di
// seguire il formato NARRAZIONE + MODIFICHE.
document.getElementById('btn-copy-instructions').addEventListener('click', async () => {
  try {
    const result = await apiFetch(`/games/${state.currentGameId}/copy-instructions`);
    await navigator.clipboard.writeText(result.promptText);
    window.audioEngine.playPageTurn();
    showAlert('action-alert', 'Istruzioni + stato copiati: incollali in una chat nuova (o in quella attuale) per "addestrare" la tua IA.', 'info');
  } catch (err) {
    showAlert('action-alert', err.message);
  }
});

// ---------------------------------------------------------
// MAPPA DEL REGNO — grafo a nodi interattivo (pan/zoom/drag, non tattico).
// Riusa le stesse route /locations già esistenti: nessuna gestione parallela.
// ---------------------------------------------------------
function escapeAttr(str) { return escapeHtml(str).replace(/"/g, '&quot;'); }

const SVG_NS = 'http://www.w3.org/2000/svg';
const mapView = { scale: 1, tx: 0, ty: 0 };
let mapPanState = null; // { startX, startY, origTx, origTy }
let mapPinchState = null; // { startDist, startScale }

document.getElementById('btn-open-map').addEventListener('click', async () => {
  document.getElementById('modal-map').classList.add('active');
  await loadAndRenderMapSvg();
});

async function loadAndRenderMapSvg() {
  try {
    const locations = await apiFetch(`/games/${state.currentGameId}/locations`);
    state.currentLocations = locations;
    renderMapSvg(locations);
  } catch (err) {
    const panel = document.getElementById('map-node-info');
    panel.style.display = 'block';
    panel.innerHTML = `<div class="alert">${escapeHtml(err.message)}</div>`;
  }
}

function currentLocationIdFromLocations(locations) {
  const name = state.currentGameState?.luogo_corrente?.nome;
  if (!name) return null;
  return locations.find((l) => l.name === name)?.id || null;
}

function renderMapSvg(locations) {
  hideMapNodeInfo();
  drawMapEdges(locations);

  const nodesG = document.getElementById('map-nodes');
  nodesG.innerHTML = '';
  const currentId = currentLocationIdFromLocations(locations);
  locations.forEach((l) => nodesG.appendChild(buildMapNode(l, l.id === currentId)));

  centerMapOn(locations, currentId);
  applyMapTransform();
}

/** Ridisegna solo le linee di collegamento, leggendo le posizioni correnti in memoria
 *  (usata sia al primo render sia durante il trascinamento di un nodo). */
function drawMapEdges(locations) {
  const edgesG = document.getElementById('map-edges');
  edgesG.innerHTML = '';
  const byId = Object.fromEntries(locations.map((l) => [l.id, l]));
  const drawn = new Set();
  locations.forEach((l) => {
    (l.connections || []).forEach((c) => {
      const other = byId[c.to];
      if (!other) return;
      const key = [l.id, other.id].sort().join('|');
      if (drawn.has(key)) return;
      drawn.add(key);
      const x1 = l.x ?? 0, y1 = l.y ?? 0, x2 = other.x ?? 0, y2 = other.y ?? 0;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 18; // leggera curva decorativa
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`);
      path.setAttribute('class', 'map-edge');
      edgesG.appendChild(path);
    });
  });
}

function isFameLocked(loc) {
  return loc.min_fame !== null && loc.min_fame !== undefined && (state.currentGameState?.fama ?? 0) < loc.min_fame;
}

function buildMapNode(loc, isCurrent) {
  const w = 116, h = 76;
  const locked = isFameLocked(loc);
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', `map-node node-appear ${isCurrent ? 'current' : ''} ${loc.discovered === false ? 'undiscovered' : ''} ${locked ? 'fame-locked' : ''}`);
  g.setAttribute('transform', `translate(${loc.x ?? 0}, ${loc.y ?? 0})`);
  g.dataset.id = loc.id;

  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', -w / 2); rect.setAttribute('y', -h / 2);
  rect.setAttribute('width', w); rect.setAttribute('height', h);
  rect.setAttribute('rx', 12);
  rect.setAttribute('class', 'node-card');
  g.appendChild(rect);

  if (locked) {
    const lock = document.createElementNS(SVG_NS, 'text');
    lock.setAttribute('x', 0); lock.setAttribute('y', -h / 2 - 6);
    lock.setAttribute('text-anchor', 'middle');
    lock.setAttribute('class', 'node-crown');
    lock.textContent = '🔒';
    g.appendChild(lock);
  }

  if (loc.discovered !== false && loc.image_url) {
    const clipId = `map-clip-${loc.id}`;
    const clip = document.createElementNS(SVG_NS, 'clipPath');
    clip.setAttribute('id', clipId);
    const clipRect = document.createElementNS(SVG_NS, 'rect');
    clipRect.setAttribute('x', -w / 2 + 4); clipRect.setAttribute('y', -h / 2 + 4);
    clipRect.setAttribute('width', w - 8); clipRect.setAttribute('height', h - 26);
    clipRect.setAttribute('rx', 8);
    clip.appendChild(clipRect);
    g.appendChild(clip);

    const img = document.createElementNS(SVG_NS, 'image');
    img.setAttribute('href', loc.image_url);
    img.setAttribute('x', -w / 2 + 4); img.setAttribute('y', -h / 2 + 4);
    img.setAttribute('width', w - 8); img.setAttribute('height', h - 26);
    img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    img.setAttribute('clip-path', `url(#${clipId})`);
    g.appendChild(img);
  }

  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('x', 0); text.setAttribute('y', h / 2 - 8);
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('class', 'node-label');
  text.textContent = loc.discovered === false ? '❓ ???' : loc.name;
  g.appendChild(text);

  if (isCurrent) {
    const crown = document.createElementNS(SVG_NS, 'text');
    crown.setAttribute('x', 0); crown.setAttribute('y', -h / 2 - 6);
    crown.setAttribute('text-anchor', 'middle');
    crown.setAttribute('class', 'node-crown');
    crown.textContent = '👑';
    g.appendChild(crown);
  }

  attachNodeDrag(g, loc);
  return g;
}

function attachNodeDrag(g, loc) {
  let dragging = false, moved = false, startX, startY, origX, origY;

  g.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY;
    origX = loc.x ?? 0; origY = loc.y ?? 0;
    g.setPointerCapture(e.pointerId);
  });
  g.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = (e.clientX - startX) / mapView.scale;
    const dy = (e.clientY - startY) / mapView.scale;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    loc.x = origX + dx;
    loc.y = origY + dy;
    g.setAttribute('transform', `translate(${loc.x}, ${loc.y})`);
    drawMapEdges(state.currentLocations);
  });
  g.addEventListener('pointerup', async (e) => {
    if (!dragging) return;
    dragging = false;
    g.releasePointerCapture(e.pointerId);
    if (moved) {
      try {
        await apiFetch(`/games/${state.currentGameId}/locations/${loc.id}/position`, {
          method: 'PUT', body: JSON.stringify({ x: loc.x, y: loc.y }),
        });
      } catch { /* posizione non salvata: non blocchiamo l'interazione per questo */ }
    } else {
      showMapNodeInfo(loc);
    }
  });
}

function centerMapOn(locations, currentId) {
  if (!locations.length) return;
  const target = locations.find((l) => l.id === currentId) || locations[0];
  const wrapper = document.getElementById('map-canvas-wrapper');
  mapView.tx = wrapper.clientWidth / 2 - (target.x ?? 0) * mapView.scale;
  mapView.ty = wrapper.clientHeight / 2 - (target.y ?? 0) * mapView.scale;
}

function applyMapTransform() {
  document.getElementById('map-viewport').setAttribute('transform', `translate(${mapView.tx}, ${mapView.ty}) scale(${mapView.scale})`);
}

function showMapNodeInfo(loc) {
  const panel = document.getElementById('map-node-info');
  const currentId = currentLocationIdFromLocations(state.currentLocations);
  const currentLoc = state.currentLocations.find((l) => l.id === currentId);
  const connectedToCurrent = currentLoc && (currentLoc.connections || []).some((c) => c.to === loc.id);
  const isCurrent = loc.id === currentId;

  const lines = [`<strong>${loc.discovered === false ? '❓ ???' : escapeHtml(loc.name)}</strong>`];
  if (loc.discovered !== false && loc.description) lines.push(escapeHtml(loc.description));
  if (isFameLocked(loc)) lines.push(`<span style="color:var(--wine-bright);">🔒 Serve fama ${loc.min_fame} (ora avete ${state.currentGameState?.fama ?? 0})</span>`);

  const actions = [];
  if (!isCurrent && connectedToCurrent && loc.discovered !== false && !isFameLocked(loc)) {
    actions.push('<button class="btn" id="map-info-travel">🐾 Vai qui</button>');
  }
  actions.push('<button class="btn-quiet" id="map-info-configure">⚙️ Modifica in Configura</button>');

  panel.innerHTML = lines.map((l) => `<div>${l}</div>`).join('') + `<div class="map-info-actions">${actions.join('')}</div>`;
  panel.style.display = 'block';

  const travelBtn = document.getElementById('map-info-travel');
  if (travelBtn) travelBtn.addEventListener('click', () => travelToLocationId(loc.id));
  document.getElementById('map-info-configure').addEventListener('click', async () => {
    document.getElementById('modal-map').classList.remove('active');
    await openConfigureModal('locations');
    startEditConfigLocation(loc);
  });
}
function hideMapNodeInfo() {
  const panel = document.getElementById('map-node-info');
  panel.style.display = 'none';
  panel.innerHTML = '';
}

/** Viaggio verso un luogo collegato: usato sia dalla mappa sia dalla minimappa. */
async function travelToLocationId(targetLocationId) {
  try {
    const result = await apiFetch(`/games/${state.currentGameId}/travel`, {
      method: 'POST',
      body: JSON.stringify({ targetLocationId }),
    });
    state.currentGameState = result.stato;
    renderRoster(state.currentGameState);
    renderScene(state.currentGameState);
    renderFameBadge(state.currentGameState);
    appendStoryEntry(`Il gruppo si sposta verso: ${state.currentGameState.luogo_corrente?.nome || '???'}.`, 'roll');
    window.audioEngine.playDoorCreak();
    await refreshMinimap();
    if (document.getElementById('modal-map').classList.contains('active')) await loadAndRenderMapSvg();
  } catch (err) {
    showAlert('action-alert', err.message);
  }
}

// ---- pan (trascinamento dello sfondo) e zoom (rotella + pizzico) ----
const mapWrapper = document.getElementById('map-canvas-wrapper');

mapWrapper.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.map-node')) return; // il nodo gestisce da sé il proprio trascinamento
  mapPanState = { startX: e.clientX, startY: e.clientY, origTx: mapView.tx, origTy: mapView.ty };
  hideMapNodeInfo();
});
mapWrapper.addEventListener('pointermove', (e) => {
  if (!mapPanState) return;
  mapView.tx = mapPanState.origTx + (e.clientX - mapPanState.startX);
  mapView.ty = mapPanState.origTy + (e.clientY - mapPanState.startY);
  applyMapTransform();
});
window.addEventListener('pointerup', () => { mapPanState = null; });

mapWrapper.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = mapWrapper.getBoundingClientRect();
  zoomMapBy(e.deltaY > 0 ? -0.1 : 0.1, e.clientX - rect.left, e.clientY - rect.top);
}, { passive: false });

function zoomMapBy(delta, anchorX, anchorY) {
  const oldScale = mapView.scale;
  const newScale = Math.min(2.5, Math.max(0.4, oldScale + delta));
  const wx = (anchorX - mapView.tx) / oldScale;
  const wy = (anchorY - mapView.ty) / oldScale;
  mapView.tx = anchorX - wx * newScale;
  mapView.ty = anchorY - wy * newScale;
  mapView.scale = newScale;
  applyMapTransform();
}

document.getElementById('btn-map-zoom-in').addEventListener('click', () => zoomMapBy(0.2, mapWrapper.clientWidth / 2, mapWrapper.clientHeight / 2));
document.getElementById('btn-map-zoom-out').addEventListener('click', () => zoomMapBy(-0.2, mapWrapper.clientWidth / 2, mapWrapper.clientHeight / 2));
document.getElementById('btn-map-zoom-reset').addEventListener('click', () => {
  mapView.scale = 1;
  centerMapOn(state.currentLocations, currentLocationIdFromLocations(state.currentLocations));
  applyMapTransform();
});

function touchDistance(touches) {
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}
mapWrapper.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) mapPinchState = { startDist: touchDistance(e.touches), startScale: mapView.scale };
}, { passive: true });
mapWrapper.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && mapPinchState) {
    e.preventDefault();
    const dist = touchDistance(e.touches);
    const newScale = Math.min(2.5, Math.max(0.4, mapPinchState.startScale * (dist / mapPinchState.startDist)));
    const rect = mapWrapper.getBoundingClientRect();
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
    const wx = (cx - mapView.tx) / mapView.scale;
    const wy = (cy - mapView.ty) / mapView.scale;
    mapView.scale = newScale;
    mapView.tx = cx - wx * newScale;
    mapView.ty = cy - wy * newScale;
    applyMapTransform();
  }
}, { passive: false });
mapWrapper.addEventListener('touchend', (e) => { if (e.touches.length < 2) mapPinchState = null; });

// ---------------------------------------------------------
// CONFIGURA — gestione Location e NPC (crea ciò che poi compare sulla
// Mappa e nella scena; niente Supabase a mano).
// ---------------------------------------------------------
document.getElementById('btn-open-configure').addEventListener('click', () => openConfigureModal('locations'));

async function openConfigureModal(tab = 'locations') {
  document.getElementById('modal-configure').classList.add('active');
  switchConfigTab(tab);
  await loadConfigLocations();
  await loadConfigNpcs();
}

function switchConfigTab(tab) {
  const isLoc = tab === 'locations';
  document.getElementById('config-tab-locations').classList.toggle('active', isLoc);
  document.getElementById('config-tab-npcs').classList.toggle('active', !isLoc);
  document.getElementById('config-panel-locations').style.display = isLoc ? 'block' : 'none';
  document.getElementById('config-panel-npcs').style.display = isLoc ? 'none' : 'block';
}
document.getElementById('config-tab-locations').addEventListener('click', () => switchConfigTab('locations'));
document.getElementById('config-tab-npcs').addEventListener('click', () => switchConfigTab('npcs'));

// ---- scheda Location ----
async function loadConfigLocations() {
  const locations = await apiFetch(`/games/${state.currentGameId}/locations`);
  state.currentLocations = locations;
  renderConfigLocationList(locations);
  populateConfigLocationConnectSelect(locations);
}

function renderConfigLocationList(locations) {
  const list = document.getElementById('config-location-list');
  list.innerHTML = '';
  if (!locations.length) {
    list.innerHTML = '<p class="field-hint">Nessuna location creata ancora.</p>';
    return;
  }
  locations.forEach((l) => {
    const div = document.createElement('div');
    div.className = 'game-list-item';
    div.style.cursor = 'pointer';
    div.innerHTML = `<div><div class="title">${escapeHtml(l.name)}</div><div class="meta">${escapeHtml(l.slug || '')}${l.discovered === false ? ' · non scoperto' : ''}</div></div>`;
    div.addEventListener('click', () => startEditConfigLocation(l));
    list.appendChild(div);
  });
}

function populateConfigLocationConnectSelect(locations) {
  const select = document.getElementById('config-loc-connect');
  select.innerHTML = '<option value="">— nessun collegamento —</option>' +
    locations.map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');
}

function startEditConfigLocation(l) {
  state.editingLocationConfigId = l.id;
  document.getElementById('config-loc-name').value = l.name || '';
  document.getElementById('config-loc-slug').value = l.slug || '';
  document.getElementById('config-loc-desc').value = l.description || '';
  document.getElementById('config-loc-image').value = l.image_url || '';
  document.getElementById('config-loc-music').value = l.music_url || '';
  document.getElementById('config-loc-discovered').checked = l.discovered !== false;
  document.getElementById('config-loc-minfame').value = l.min_fame ?? '';
  document.getElementById('config-loc-connect-field').style.display = 'none';
  document.getElementById('config-loc-connect-existing-field').style.display = 'block';
  populateConnectExistingSelect(l);
  document.getElementById('config-location-form-title').textContent = `Modifica: ${l.name}`;
  document.getElementById('btn-save-config-location').textContent = 'Salva modifiche';
  document.getElementById('btn-cancel-config-location').style.display = 'inline-block';
  document.getElementById('btn-delete-config-location').style.display = 'inline-block';
  showAlert('config-location-alert', '');
  switchConfigTab('locations');
  document.getElementById('config-location-form-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Popola il selettore "collega a un luogo già esistente", escludendo se stesso e chi è già collegato. */
function populateConnectExistingSelect(l) {
  const select = document.getElementById('config-loc-connect-existing');
  const already = new Set((l.connections || []).map((c) => c.to));
  const options = (state.currentLocations || []).filter((o) => o.id !== l.id && !already.has(o.id));
  select.innerHTML = options.length
    ? options.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')
    : '<option value="">— nessun altro luogo disponibile —</option>';
}

document.getElementById('btn-connect-existing-location').addEventListener('click', async () => {
  const targetLocationId = document.getElementById('config-loc-connect-existing').value;
  if (!targetLocationId || !state.editingLocationConfigId) return;
  try {
    await apiFetch(`/games/${state.currentGameId}/locations/${state.editingLocationConfigId}/connect`, {
      method: 'POST',
      body: JSON.stringify({ targetLocationId, label: '' }),
    });
    await loadConfigLocations();
    const refreshed = state.currentLocations.find((l) => l.id === state.editingLocationConfigId);
    if (refreshed) startEditConfigLocation(refreshed);
    await refreshMinimap();
    showAlert('config-location-alert', 'Collegamento creato.', 'info');
  } catch (err) {
    showAlert('config-location-alert', err.message);
  }
});

function resetConfigLocationForm() {
  state.editingLocationConfigId = null;
  document.getElementById('config-loc-name').value = '';
  document.getElementById('config-loc-slug').value = '';
  document.getElementById('config-loc-desc').value = '';
  document.getElementById('config-loc-image').value = '';
  document.getElementById('config-loc-music').value = '';
  document.getElementById('config-loc-discovered').checked = true;
  document.getElementById('config-loc-minfame').value = '';
  document.getElementById('config-loc-connect-field').style.display = 'block';
  document.getElementById('config-loc-connect-existing-field').style.display = 'none';
  document.getElementById('config-location-form-title').textContent = '+ Nuova location';
  document.getElementById('btn-save-config-location').textContent = 'Salva location';
  document.getElementById('btn-cancel-config-location').style.display = 'none';
  document.getElementById('btn-delete-config-location').style.display = 'none';
  showAlert('config-location-alert', '');
}
document.getElementById('btn-cancel-config-location').addEventListener('click', resetConfigLocationForm);

document.getElementById('btn-save-config-location').addEventListener('click', async () => {
  const name = document.getElementById('config-loc-name').value.trim();
  if (!name) return showAlert('config-location-alert', 'Il nome è obbligatorio.');

  const payload = {
    name,
    description: document.getElementById('config-loc-desc').value.trim(),
    image_url: document.getElementById('config-loc-image').value.trim(),
    music_url: document.getElementById('config-loc-music').value.trim(),
    discovered: document.getElementById('config-loc-discovered').checked,
    min_fame: document.getElementById('config-loc-minfame').value.trim(),
  };
  const slugValue = document.getElementById('config-loc-slug').value.trim();
  if (slugValue) payload.slug = slugValue;

  try {
    if (state.editingLocationConfigId) {
      await apiFetch(`/games/${state.currentGameId}/locations/${state.editingLocationConfigId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      const connectedToLocationId = document.getElementById('config-loc-connect').value || undefined;
      await apiFetch(`/games/${state.currentGameId}/locations`, { method: 'POST', body: JSON.stringify({ ...payload, connectedToLocationId }) });
    }
    resetConfigLocationForm();
    await loadConfigLocations();
    await refreshMinimap();
    state.currentGameState = await apiFetch(`/games/${state.currentGameId}`);
    renderScene(state.currentGameState);
    renderFameBadge(state.currentGameState);
  } catch (err) {
    showAlert('config-location-alert', err.message);
  }
});

document.getElementById('btn-delete-config-location').addEventListener('click', async () => {
  if (!state.editingLocationConfigId) return;
  if (!confirm('Eliminare questa location? Verranno rimossi anche i suoi collegamenti.')) return;
  await apiFetch(`/games/${state.currentGameId}/locations/${state.editingLocationConfigId}`, { method: 'DELETE' });
  resetConfigLocationForm();
  await loadConfigLocations();
  await refreshMinimap();
});

// ---- scheda NPC ----
async function loadConfigNpcs() {
  const npcs = await apiFetch(`/games/${state.currentGameId}/npcs`);
  state.configNpcs = npcs;
  renderConfigNpcList(npcs);
}

function renderConfigNpcList(npcs) {
  const list = document.getElementById('config-npc-list');
  list.innerHTML = '';
  if (!npcs.length) {
    list.innerHTML = '<p class="field-hint">Nessun NPC creato ancora.</p>';
    return;
  }
  npcs.forEach((n) => {
    const div = document.createElement('div');
    div.className = 'game-list-item';
    div.style.cursor = 'pointer';
    div.innerHTML = `<div><div class="title">${escapeHtml(n.name)}${n.is_hostile ? ' ⚔' : ''}</div><div class="meta">${escapeHtml(n.slug || '')}</div></div>`;
    div.addEventListener('click', () => startEditConfigNpc(n));
    list.appendChild(div);
  });
}

function populateConfigNpcLocationsChecklist(selectedIds = []) {
  const wrap = document.getElementById('config-npc-locations-checklist');
  const locations = state.currentLocations || [];
  wrap.innerHTML = locations.length
    ? locations.map((l) => `
        <label style="display:flex; align-items:center; gap:8px; padding:4px 0;">
          <input type="checkbox" class="npc-loc-check" value="${l.id}" ${selectedIds.includes(l.id) ? 'checked' : ''}>
          ${escapeHtml(l.name)}
        </label>`).join('')
    : '<p class="field-hint">Crea prima almeno una location.</p>';
}

document.getElementById('config-npc-hostile').addEventListener('change', (e) => {
  document.getElementById('config-npc-hp-field').style.display = e.target.checked ? 'block' : 'none';
});

function startEditConfigNpc(n) {
  state.editingNpcConfigId = n.id;
  document.getElementById('config-npc-name').value = n.name || '';
  document.getElementById('config-npc-slug').value = n.slug || '';
  document.getElementById('config-npc-desc').value = n.description || '';
  document.getElementById('config-npc-image').value = n.avatar_url || '';
  document.getElementById('config-npc-fallback').value = n.fallback_image || '';
  document.getElementById('config-npc-hostile').checked = Boolean(n.is_hostile);
  document.getElementById('config-npc-hp-field').style.display = n.is_hostile ? 'block' : 'none';
  document.getElementById('config-npc-hp').value = n.hp || 10;
  populateConfigNpcLocationsChecklist(n.associatedLocationIds || []);
  document.getElementById('config-npc-form-title').textContent = `Modifica: ${n.name}`;
  document.getElementById('btn-save-config-npc').textContent = 'Salva modifiche';
  document.getElementById('btn-cancel-config-npc').style.display = 'inline-block';
  document.getElementById('btn-delete-config-npc').style.display = 'inline-block';
  showAlert('config-npc-alert', '');
  switchConfigTab('npcs');
}

function resetConfigNpcForm() {
  state.editingNpcConfigId = null;
  document.getElementById('config-npc-name').value = '';
  document.getElementById('config-npc-slug').value = '';
  document.getElementById('config-npc-desc').value = '';
  document.getElementById('config-npc-image').value = '';
  document.getElementById('config-npc-fallback').value = '';
  document.getElementById('config-npc-hostile').checked = false;
  document.getElementById('config-npc-hp-field').style.display = 'none';
  document.getElementById('config-npc-hp').value = 10;
  populateConfigNpcLocationsChecklist([]);
  document.getElementById('config-npc-form-title').textContent = '+ Nuovo NPC';
  document.getElementById('btn-save-config-npc').textContent = 'Salva NPC';
  document.getElementById('btn-cancel-config-npc').style.display = 'none';
  document.getElementById('btn-delete-config-npc').style.display = 'none';
  showAlert('config-npc-alert', '');
}
document.getElementById('btn-cancel-config-npc').addEventListener('click', resetConfigNpcForm);

document.getElementById('btn-save-config-npc').addEventListener('click', async () => {
  const name = document.getElementById('config-npc-name').value.trim();
  if (!name) return showAlert('config-npc-alert', 'Il nome è obbligatorio.');

  const associatedLocationIds = [...document.querySelectorAll('.npc-loc-check:checked')].map((el) => el.value);
  const payload = {
    name,
    description: document.getElementById('config-npc-desc').value.trim(),
    imageUrl: document.getElementById('config-npc-image').value.trim(),
    fallbackImage: document.getElementById('config-npc-fallback').value.trim(),
    isHostile: document.getElementById('config-npc-hostile').checked,
    hp: Number(document.getElementById('config-npc-hp').value) || 10,
    associatedLocationIds,
  };
  const slugValue = document.getElementById('config-npc-slug').value.trim();
  if (slugValue) payload.slug = slugValue;

  try {
    if (state.editingNpcConfigId) {
      await apiFetch(`/games/${state.currentGameId}/npcs/${state.editingNpcConfigId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await apiFetch(`/games/${state.currentGameId}/npcs`, { method: 'POST', body: JSON.stringify(payload) });
    }
    resetConfigNpcForm();
    await loadConfigNpcs();
  } catch (err) {
    showAlert('config-npc-alert', err.message);
  }
});

document.getElementById('btn-delete-config-npc').addEventListener('click', async () => {
  if (!state.editingNpcConfigId) return;
  if (!confirm('Eliminare questo NPC?')) return;
  await apiFetch(`/games/${state.currentGameId}/npcs/${state.editingNpcConfigId}`, { method: 'DELETE' });
  resetConfigNpcForm();
  await loadConfigNpcs();
});

document.getElementById('btn-open-inventory').addEventListener('click', () => {
  renderInventoryModal();
  document.getElementById('modal-inventory').classList.add('active');
});

const EQUIPMENT_SLOTS = [
  { key: 'armatura', label: '🛡️ Armatura' },
  { key: 'amuleto', label: '🔮 Amuleto' },
];

function renderInventoryModal() {
  const content = document.getElementById('inventory-content');
  content.innerHTML = '';
  state.currentGameState.personaggi.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'inventory-owner';

    const equippedByslot = {};
    p.inventario.forEach((i) => { if (i.equipaggiato) equippedByslot[i.equipaggiato] = i; });

    const slotsHtml = EQUIPMENT_SLOTS.map(({ key, label }) => {
      const item = equippedByslot[key];
      return `
        <div class="equip-slot">
          <span class="equip-slot-label">${label}</span>
          ${item
            ? `<span class="equip-slot-item">${escapeHtml(item.nome)}</span><button class="btn-quiet act-unequip" data-inv="${item.id}" data-gc="${p.game_character_id}">Togli</button>`
            : `<span class="equip-slot-empty">vuoto</span>`}
        </div>`;
    }).join('');

    const unequipped = p.inventario.filter((i) => !i.equipaggiato);
    const itemsHtml = unequipped.length
      ? unequipped.map((i) => `
          <div class="inventory-item">
            <span>• ${escapeHtml(i.nome)} ${i.quantita > 1 ? `×${i.quantita}` : ''}</span>
            ${EQUIPMENT_SLOTS.map(({ key, label }) => `<button class="btn-quiet act-equip" data-inv="${i.id}" data-gc="${p.game_character_id}" data-slot="${key}">${label.split(' ')[0]}</button>`).join('')}
          </div>`).join('')
      : '<div class="inventory-item field-hint">Sacca vuota.</div>';

    div.innerHTML = `
      <div class="owner-name">${escapeHtml(p.nome)}</div>
      <div class="equip-slots">${slotsHtml}</div>
      ${itemsHtml}`;
    content.appendChild(div);
  });
}

document.getElementById('inventory-content').addEventListener('click', async (e) => {
  const equipBtn = e.target.closest('.act-equip');
  const unequipBtn = e.target.closest('.act-unequip');
  try {
    if (equipBtn) {
      const result = await apiFetch(`/games/${state.currentGameId}/inventory/${equipBtn.dataset.inv}/equip`, {
        method: 'POST',
        body: JSON.stringify({ gameCharacterId: equipBtn.dataset.gc, slot: equipBtn.dataset.slot }),
      });
      state.currentGameState = result.stato;
      renderInventoryModal();
    } else if (unequipBtn) {
      const result = await apiFetch(`/games/${state.currentGameId}/inventory/${unequipBtn.dataset.inv}/unequip`, {
        method: 'POST',
        body: JSON.stringify({ gameCharacterId: unequipBtn.dataset.gc }),
      });
      state.currentGameState = result.stato;
      renderInventoryModal();
    }
  } catch (err) {
    alert(err.message);
  }
});

// ---------------------------------------------------------
// DASHBOARD — HP, energia, livello di ogni personaggio in un colpo d'occhio
// ---------------------------------------------------------
document.getElementById('btn-open-dashboard').addEventListener('click', () => {
  renderDashboard();
  document.getElementById('modal-dashboard').classList.add('active');
});

function renderDashboard() {
  const content = document.getElementById('dashboard-content');
  content.innerHTML = '';
  state.currentGameState.personaggi.forEach((p) => {
    const [curHp, maxHp] = p.hp.split('/').map(Number);
    const [curEn, maxEn] = p.energia.split('/').map(Number);
    const xpForLevel = XP_THRESHOLDS[p.livello + 1];
    const xpBaseline = XP_THRESHOLDS[p.livello] ?? 0;
    const xpProgress = xpForLevel ? Math.min(100, Math.round(((p.xp - xpBaseline) / (xpForLevel - xpBaseline)) * 100)) : 100;

    const card = document.createElement('div');
    card.className = 'dashboard-card';
    card.innerHTML = `
      <div class="dashboard-card-header">
        <span class="medallion" data-avatar></span>
        <div>
          <div class="title">${escapeHtml(p.nome)}</div>
          <div class="meta">${escapeHtml(p.classe)} · Livello ${p.livello}</div>
        </div>
      </div>
      <div class="stat-bar-row"><span>❤️ HP</span><div class="stat-bar"><div class="stat-bar-fill hp-fill" style="width:${Math.round((curHp / maxHp) * 100)}%"></div></div><span>${curHp}/${maxHp}</span></div>
      <div class="stat-bar-row"><span>⚡ Energia</span><div class="stat-bar"><div class="stat-bar-fill energy-fill" style="width:${Math.round((curEn / maxEn) * 100)}%"></div></div><span>${curEn}/${maxEn}</span></div>
      ${xpForLevel ? `<div class="stat-bar-row"><span>⭐ XP</span><div class="stat-bar"><div class="stat-bar-fill xp-fill" style="width:${xpProgress}%"></div></div><span>${p.xp}/${xpForLevel}</span></div>` : `<div class="field-hint">Livello massimo raggiunto.</div>`}
      <div class="dashboard-stats-grid">
        <span>Forza ${p.statistiche.forza}</span><span>Agilità ${p.statistiche.agilita}</span>
        <span>Astuzia ${p.statistiche.astuzia}</span><span>Coraggio ${p.statistiche.coraggio}</span>
      </div>
      ${p.punti_abilita_da_assegnare > 0 ? `<button class="btn btn-primary act-allocate" data-gc="${p.game_character_id}">🎉 ${p.punti_abilita_da_assegnare} punto/i abilità da assegnare</button>` : ''}
    `;
    applyCatAppearance(card.querySelector('[data-avatar]'), { name: p.nome, avatarUrl: p.avatar, appearance: p.aspetto });
    content.appendChild(card);
  });
}

document.getElementById('dashboard-content').addEventListener('click', (e) => {
  const btn = e.target.closest('.act-allocate');
  if (!btn) return;
  const character = state.currentGameState.personaggi.find((p) => p.game_character_id === btn.dataset.gc);
  if (character) openLevelUpModal(character);
});

// ---------------------------------------------------------
// PAGINA "assegna punto abilità" — mostrata al salire di livello
// ---------------------------------------------------------
function openLevelUpModal(character) {
  document.getElementById('levelup-subtitle').textContent =
    `${character.nome} ha ${character.punti_abilita_da_assegnare} punto/i abilità da assegnare. Su quale statistica?`;
  const content = document.getElementById('levelup-content');
  const stats = [
    { key: 'forza', label: 'Forza' }, { key: 'agilita', label: 'Agilità' },
    { key: 'astuzia', label: 'Astuzia' }, { key: 'coraggio', label: 'Coraggio' },
  ];
  content.innerHTML = stats.map((s) => `
    <button class="btn levelup-stat-btn" data-gc="${character.game_character_id}" data-stat="${s.key}">
      ${s.label} <span class="levelup-stat-value">${character.statistiche[s.key]}</span> → ${Math.min(6, character.statistiche[s.key] + 1)}
    </button>`).join('');
  document.getElementById('modal-levelup').classList.add('active');
}

document.getElementById('levelup-content').addEventListener('click', async (e) => {
  const btn = e.target.closest('.levelup-stat-btn');
  if (!btn) return;
  try {
    const result = await apiFetch(`/games/${state.currentGameId}/characters/${btn.dataset.gc}/allocate-skill`, {
      method: 'POST',
      body: JSON.stringify({ stat: btn.dataset.stat }),
    });
    state.currentGameState = result.stato;
    const character = state.currentGameState.personaggi.find((p) => p.game_character_id === btn.dataset.gc);
    renderDashboard();
    if (character && character.punti_abilita_da_assegnare > 0) {
      openLevelUpModal(character); // ne restano altri: si continua subito
    } else {
      document.getElementById('modal-levelup').classList.remove('active');
    }
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('btn-open-chronicle').addEventListener('click', async () => {
  const content = document.getElementById('chronicle-content');
  content.innerHTML = '<p class="field-hint">Si sfogliano gli annali...</p>';
  document.getElementById('modal-chronicle').classList.add('active');
  try {
    const chronicle = await apiFetch(`/games/${state.currentGameId}/chronicle`);
    content.innerHTML = '';
    if (chronicle.capitoli.length) {
      chronicle.capitoli.forEach((c) => {
        const div = document.createElement('div');
        div.className = 'chronicle-chapter';
        div.innerHTML = `<h3>Capitolo ${c.chapter_number} — ${escapeHtml(c.title)}</h3><p>${escapeHtml(c.summary)}</p>`;
        content.appendChild(div);
      });
    } else {
      content.innerHTML = '<p class="field-hint">Nessun capitolo ancora concluso. Ecco gli eventi finora:</p>';
      chronicle.eventi.forEach((e) => {
        const p = document.createElement('p');
        p.style.fontSize = '0.88rem';
        p.textContent = e.content;
        content.appendChild(p);
      });
    }
  } catch (err) {
    content.innerHTML = `<div class="alert">${escapeHtml(err.message)}</div>`;
  }
});

// ---- pannello audio ----
document.getElementById('btn-open-audio').addEventListener('click', () => {
  const engine = window.audioEngine;
  document.getElementById('audio-music-toggle').checked = engine.settings.musicOn;
  document.getElementById('audio-music-volume').value = engine.settings.musicVolume;
  document.getElementById('audio-sfx-volume').value = engine.settings.sfxVolume;
  document.getElementById('modal-audio').classList.add('active');
});

document.getElementById('audio-music-toggle').addEventListener('change', (e) => {
  window.audioEngine.toggleMusic(e.target.checked);
});
document.getElementById('audio-music-volume').addEventListener('input', (e) => {
  window.audioEngine.setMusicVolume(Number(e.target.value));
});
document.getElementById('audio-sfx-volume').addEventListener('input', (e) => {
  window.audioEngine.setSfxVolume(Number(e.target.value));
  window.audioEngine.playDiceRoll();
});

// ---------------------------------------------------------
// PWA: registra il service worker (app shell in cache + installabilità)
// ---------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // se fallisce (es. pagina aperta da file:// invece che da un server), l'app
      // funziona comunque normalmente: il service worker è solo un miglioramento.
    });
  });
}

// ---------------------------------------------------------
// Avvio: se c'è già una sessione Supabase valida, entra subito
// ---------------------------------------------------------
(async function init() {
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    state.session = data.session;
    await enterKingdom();
  }
})();
