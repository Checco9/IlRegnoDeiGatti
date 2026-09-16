// =========================================================
// MOTORE AUDIO — tutti i suoni sono sintetizzati al volo con
// la Web Audio API: nessun file da scaricare, nessun problema
// di licenze, funziona offline. "Semplice ma efficace", come
// richiesto: pochi suoni, usati solo quando è davvero utile.
// =========================================================

const STORAGE_KEY = 'gdr-gatti-audio-settings';

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignora, usa i default */ }
  return { musicOn: true, musicVolume: 0.25, sfxVolume: 0.6 };
}

function saveSettings(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* storage non disponibile */ }
}

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.settings = loadSettings();
    this.ambientNodes = null;
    this.ambientMode = 'esplorazione'; // esplorazione | combattimento
  }

  // L'AudioContext va creato/ripreso dopo un gesto dell'utente (regola dei browser).
  ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  // ---- suoni brevi (effetti) --------------------------------------------

  playDiceRoll() {
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      const t = now + i * 0.06;
      this._click(t, 700 + Math.random() * 900, 0.04);
    }
  }

  playSuccess() {
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      this._tone(now + i * 0.09, freq, 0.18, 'triangle', 0.5);
    });
  }

  playFailure() {
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    [220, 185, 146.83].forEach((freq, i) => {
      this._tone(now + i * 0.1, freq, 0.25, 'sawtooth', 0.35);
    });
  }

  playPageTurn() {
    const ctx = this.ensureContext();
    this._noiseBurst(ctx.currentTime, 0.25, 1800, 0.3);
  }

  playBell() {
    const ctx = this.ensureContext();
    this._tone(ctx.currentTime, 1318.5, 0.6, 'sine', 0.4);
    this._tone(ctx.currentTime, 2637, 0.4, 'sine', 0.15);
  }

  playDoorCreak() {
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = this._gainNode(0.25);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.linearRampToValueAtTime(90, now + 0.5);
    osc.connect(gain);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(this._sfxGain(0.25), now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc.start(now);
    osc.stop(now + 0.6);
  }

  playMeowBlip() {
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = this._gainNode(0.2);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(480, now);
    osc.frequency.linearRampToValueAtTime(760, now + 0.09);
    osc.frequency.linearRampToValueAtTime(340, now + 0.22);
    osc.connect(gain);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(this._sfxGain(0.22), now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  // ---- musica d'ambiente (pad generativo, in loop finché attivo) --------

  startAmbient(mode = 'esplorazione') {
    this.ambientMode = mode;
    if (!this.settings.musicOn) return;
    this.stopAmbient();
    const ctx = this.ensureContext();

    const master = ctx.createGain();
    master.gain.value = this._musicGain(1);
    master.connect(ctx.destination);

    const chordSets = {
      esplorazione: [220, 277.18, 329.63], // La minore, calmo
      combattimento: [196, 233.08, 293.66], // più teso
    };
    const freqs = chordSets[mode] || chordSets.esplorazione;
    const oscillators = freqs.map((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      osc.connect(g).connect(master);
      osc.start();
      // fade-in morbido
      g.gain.linearRampToValueAtTime(0.18 / freqs.length, ctx.currentTime + 1.2 + i * 0.2);
      return { osc, gain: g };
    });

    // leggero LFO sul volume per dare "respiro" al pad, più rapido in combattimento
    const lfo = ctx.createOscillator();
    lfo.frequency.value = mode === 'combattimento' ? 0.35 : 0.12;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.05;
    lfo.connect(lfoGain).connect(master.gain);
    lfo.start();

    this.ambientNodes = { master, oscillators, lfo };
  }

  stopAmbient() {
    if (!this.ambientNodes) return;
    const { master, oscillators, lfo } = this.ambientNodes;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    master.gain.linearRampToValueAtTime(0.0001, now + 0.6);
    setTimeout(() => {
      oscillators.forEach(({ osc }) => { try { osc.stop(); } catch { /* già fermo */ } });
      try { lfo.stop(); } catch { /* già fermo */ }
    }, 700);
    this.ambientNodes = null;
  }

  setAmbientMode(mode) {
    if (mode === this.ambientMode && this.ambientNodes) return;
    if (this.settings.musicOn) this.startAmbient(mode);
    else this.ambientMode = mode;
  }

  // ---- impostazioni -------------------------------------------------------

  toggleMusic(on) {
    this.settings.musicOn = on;
    saveSettings(this.settings);
    if (on) this.startAmbient(this.ambientMode);
    else this.stopAmbient();
  }

  setMusicVolume(v) {
    this.settings.musicVolume = v;
    saveSettings(this.settings);
    if (this.ambientNodes) this.ambientNodes.master.gain.value = this._musicGain(1);
  }

  setSfxVolume(v) {
    this.settings.sfxVolume = v;
    saveSettings(this.settings);
  }

  // ---- helper interni -------------------------------------------------

  _musicGain(base) { return base * this.settings.musicVolume; }
  _sfxGain(base) { return base * this.settings.sfxVolume; }

  _gainNode(base) {
    const g = this.ctx.createGain();
    g.gain.value = this._sfxGain(base);
    g.connect(this.ctx.destination);
    return g;
  }

  _tone(startTime, freq, duration, type = 'sine', peak = 0.3) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain).connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(this._sfxGain(peak), startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  _click(startTime, freq, duration) {
    this._tone(startTime, freq, duration, 'square', 0.18);
  }

  _noiseBurst(startTime, duration, filterFreq, peak) {
    const ctx = this.ctx;
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.value = this._sfxGain(peak);

    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(startTime);
  }
}

window.audioEngine = new AudioEngine();
