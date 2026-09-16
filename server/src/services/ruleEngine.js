// =========================================================
// RULE ENGINE — l'unica parte del sistema che genera numeri.
// L'IA non lancia MAI i dadi: propone solo "che tipo di prova serve",
// e questo modulo esegue davvero il tiro.
// =========================================================

export const STATS = ['forza', 'agilita', 'astuzia', 'coraggio'];

export const DIFFICULTY = {
  facile: 8,
  normale: 12,
  difficile: 16,
  estremo: 20,
};

/** Tira un d20 vero (1-20), crypto-random quanto basta per un gioco. */
export function rollD20() {
  return Math.floor(Math.random() * 20) + 1;
}

/**
 * Risolve una prova di abilità.
 * @param {number} statValue - valore della statistica (0-3) del personaggio.
 * @param {number|string} difficulty - soglia numerica oppure chiave di DIFFICULTY.
 * @returns {{ roll: number, statValue: number, total: number, difficulty: number, success: boolean, criticalSuccess: boolean, criticalFailure: boolean }}
 */
export function resolveSkillCheck(statValue, difficulty) {
  const threshold = typeof difficulty === 'string' ? DIFFICULTY[difficulty] : difficulty;
  if (!threshold) throw new Error(`Difficoltà non valida: ${difficulty}`);

  const roll = rollD20();
  const total = roll + (statValue ?? 0);

  return {
    roll,
    statValue: statValue ?? 0,
    total,
    difficulty: threshold,
    success: total >= threshold,
    criticalSuccess: roll === 20,
    criticalFailure: roll === 1,
  };
}

/**
 * Risolve un'azione di combattimento: attacco di un personaggio contro
 * la "difficoltà di difesa" di un NPC ostile, oppure viceversa.
 * Il danno è tenuto volutamente semplice e piatto.
 */
export function resolveCombatAction({ attackerStatValue, defenderDifficulty, baseDamage = 3 }) {
  const check = resolveSkillCheck(attackerStatValue, defenderDifficulty);
  let damage = 0;
  if (check.success) {
    damage = baseDamage + (check.criticalSuccess ? 3 : 0);
  }
  if (check.criticalFailure) {
    damage = 0;
  }
  return { ...check, damage };
}

/** Determina lo stato narrativo di un personaggio quando gli HP calano. */
export function statusForHp(currentHp, maxHp) {
  if (currentHp <= 0) return 'svenuto';
  if (currentHp <= maxHp * 0.25) return 'esausto';
  if (currentHp <= maxHp * 0.5) return 'ferito';
  return 'in_forma';
}

/** Applica un delta di HP restando dentro [0, maxHp], mai sotto zero. */
export function clampHp(currentHp, delta, maxHp) {
  return Math.max(0, Math.min(maxHp, currentHp + delta));
}

// =========================================================
// LIVELLI E PUNTI ABILITÀ
// =========================================================

/** XP cumulativi necessari per raggiungere ciascun livello (indice = livello). */
export const XP_THRESHOLDS = { 1: 0, 2: 100, 3: 250, 4: 450, 5: 700 };
export const MAX_LEVEL = 5;
export const MAX_STAT_BONUS = 3; // punti abilità investibili al massimo in UNA statistica

/** Dato l'xp totale, calcola il livello corrispondente (1..MAX_LEVEL). */
export function levelForXp(xp) {
  let level = 1;
  for (let l = 2; l <= MAX_LEVEL; l++) {
    if (xp >= XP_THRESHOLDS[l]) level = l;
  }
  return level;
}

/** Statistica effettiva = base del personaggio + bonus assegnati in questa partita, tenuta tra 0 e 6. */
export function effectiveStat(baseValue, bonusValue) {
  return Math.max(0, Math.min(6, (baseValue ?? 0) + (bonusValue ?? 0)));
}

