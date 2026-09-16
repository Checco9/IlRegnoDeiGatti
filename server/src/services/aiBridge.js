// =========================================================
// AI BRIDGE — nessuna API IA integrata.
// Questo modulo fa solo due cose:
//  1) costruisce un testo pronto da copiare e incollare nell'IA
//     esterna scelta dal giocatore (ChatGPT, Gemini, ecc.)
//  2) analizza il testo che il giocatore incolla indietro nel
//     programma, lo divide in NARRAZIONE + MODIFICHE, e valida
//     ogni singola modifica contro lo stato REALE della partita
//     prima di proporla in anteprima. Il programma non si fida
//     mai ciecamente di quello che l'IA ha scritto.
// =========================================================

const VALID_SCENES = ['esplorazione', 'dialogo', 'combattimento', 'puzzle', 'evento', 'viaggio', 'boss'];

const QUEST_STATUS_SYNONYMS = {
  'non iniziata': 'non_iniziata',
  'non_iniziata': 'non_iniziata',
  attiva: 'attiva',
  avanzamento: 'attiva',
  iniziata: 'attiva',
  in_corso: 'attiva',
  'in corso': 'attiva',
  completata: 'completata',
  conclusa: 'completata',
  fallita: 'fallita',
};

/**
 * Costruisce il blocco di testo da copiare per l'IA esterna.
 * @param {object} gameState - stato compatto (getCompactGameState)
 * @param {string} actionText - cosa hanno scritto i giocatori
 * @param {object|null} diceResult - { stat, statValue, roll, total, difficulty, success } oppure null
 */
/**
 * Le istruzioni di formato (NARRAZIONE + MODIFICHE) in comune tra il primo
 * messaggio di una chat e il pulsante "🎓 Istruisci l'IA", per poterle
 * ri-mandare in qualsiasi momento — non solo all'inizio dell'avventura —
 * es. se apri una nuova chat con la tua IA a metà partita, o se l'IA
 * "dimentica" il formato dopo molti messaggi.
 */
function buildInstructionsLines() {
  const lines = [];
  lines.push('Sei il Game Master di "GDR dei Gatti": narrazione avventurosa, ironica, a tratti');
  lines.push('assurda, in un mondo di gatti. Rispondi SEMPRE in due sezioni, in questo formato ESATTO:');
  lines.push('');
  lines.push('📖 NARRAZIONE');
  lines.push('(il tuo racconto qui, coerente con lo stato e — se presente — con il risultato del tiro)');
  lines.push('');
  lines.push('⚙️ MODIFICHE DA APPLICARE');
  lines.push('POSIZIONE: <invariata oppure "vecchio luogo → nuovo luogo">');
  lines.push('HP <NOME PERSONAGGIO>: <delta con segno, es. -2, oppure "invariato">');
  lines.push('ENERGIA <NOME PERSONAGGIO>: <delta con segno, es. -3, oppure "invariata"> (mana/stamina usata per azioni speciali)');
  lines.push('XP <NOME PERSONAGGIO>: <quantità guadagnata, es. +20, oppure "Nessuno">');
  lines.push('FAMA: <delta con segno, es. +5 o -3, oppure "invariata"> (fama del GRUPPO, non di un singolo personaggio)');
  lines.push('OGGETTO AGGIUNTO: <nome oggetto (Nome personaggio) oppure "Nessuno">');
  lines.push('OGGETTO RIMOSSO: <nome oggetto (Nome personaggio) oppure "Nessuno">');
  lines.push('EQUIPAGGIA: <nome oggetto> (Nome personaggio) → <slot: armatura oppure amuleto>, oppure "Nessuno"');
  lines.push('RIMUOVI EQUIPAGGIAMENTO: <slot: armatura oppure amuleto> (Nome personaggio), oppure "Nessuno"');
  lines.push('MISSIONE: <titolo missione → nuovo stato, oppure "invariata">');
  lines.push('NPC: <nome> (img:percorso immagine, facoltativo) → <breve descrizione, oppure "Nessuno">');
  lines.push('NEMICO: <nome> (HP:<numero>) (img:percorso immagine, facoltativo) → <breve descrizione, oppure "Nessuno">');
  lines.push('SCENA: <una tra esplorazione, dialogo, combattimento, puzzle, evento, viaggio, boss>');
  lines.push('EVENTO: <una riga di evento importante da ricordare, oppure "Nessuno">');
  lines.push('');
  lines.push('Non inventare mai il risultato di un\'azione rischiosa: se non trovi qui sotto il');
  lines.push('risultato di un tiro ma l\'azione è incerta, chiedi tu stesso quale prova serve');
  lines.push('invece di narrarne l\'esito.');
  lines.push('');
  lines.push('Se un luogo o un NPC nello stato qui sotto ha un "[ID: ...]", per POSIZIONE/NPC/NEMICO');
  lines.push('puoi usare quell\'ID stabile invece del nome (utile se rinomini qualcosa più avanti);');
  lines.push('altrimenti va benissimo anche il solo nome, il programma prova entrambi.');
  return lines;
}

export function buildPromptText(gameState, actionText, diceResult = null) {
  const lines = buildInstructionsLines();
  lines.push('');
  lines.push('--- AZIONE DEI GIOCATORI ---');
  lines.push(actionText);
  lines.push('');

  if (diceResult) {
    lines.push('--- PROVA RICHIESTA ---');
    lines.push(`Statistica: ${capitalize(diceResult.stat)}`);
    lines.push(`Tiro: ${diceResult.roll} + ${diceResult.statValue} = ${diceResult.total}`);
    lines.push(`Difficoltà: ${diceResult.difficulty}`);
    lines.push(`Risultato: ${diceResult.success ? 'SUCCESSO' : 'FALLIMENTO'}${diceResult.criticalSuccess ? ' (critico!)' : ''}${diceResult.criticalFailure ? ' (fallimento critico!)' : ''}`);
    lines.push('');
  }

  lines.push('--- STATO DELLA PARTITA ---');
  lines.push(buildStateSummary(gameState));

  return lines.join('\n');
}

/** Testo per il pulsante "📋 Copia stato per IA" (nessuna azione, solo contesto). */
export function buildStateOnlyPromptText(gameState) {
  return [
    'Ecco lo stato aggiornato della nostra partita di "GDR dei Gatti" (nessuna nuova',
    'azione: usalo solo come contesto per le prossime risposte).',
    '',
    buildStateSummary(gameState),
  ].join('\n');
}

/**
 * Testo per il pulsante "🎓 Istruisci l'IA": istruzioni di formato complete +
 * stato attuale, senza nessuna azione. Pensato per essere usato in QUALSIASI
 * momento della partita — non solo all'inizio — ogni volta che apri una
 * nuova chat con la tua IA o che smette di seguire il formato richiesto.
 */
export function buildTrainingPromptText(gameState) {
  const lines = buildInstructionsLines();
  lines.push('');
  lines.push('Questo messaggio non contiene una nuova azione dei giocatori: serve solo a');
  lines.push('spiegarti (o ricordarti) le regole sopra e darti lo stato attuale della partita.');
  lines.push('Non narrare nulla di nuovo, limitati a confermare di aver capito il formato.');
  lines.push('');
  lines.push('--- STATO DELLA PARTITA ---');
  lines.push(buildStateSummary(gameState));
  return lines.join('\n');
}


function buildStateSummary(gameState) {
  const lines = [];
  lines.push(`Titolo: ${gameState.titolo} (tono: ${gameState.tono})`);
  lines.push(`Fama del gruppo: ${gameState.fama ?? 0} (da -100 a 100; influenza come vi trattano NPC e luoghi)`);
  if (gameState.luogo_corrente) {
    lines.push(`Luogo attuale: ${gameState.luogo_corrente.nome}${gameState.luogo_corrente.slug ? ` [ID: ${gameState.luogo_corrente.slug}]` : ''} — ${gameState.luogo_corrente.descrizione || ''}`);
  }
  lines.push('Personaggi:');
  gameState.personaggi.forEach((p) => {
    const inv = p.inventario.length
      ? p.inventario.map((i) => `${i.nome}${i.quantita > 1 ? ` x${i.quantita}` : ''}${i.equipaggiato ? ` [equipaggiato: ${i.equipaggiato}]` : ''}`).join(', ')
      : 'vuoto';
    lines.push(`  - ${p.nome} (${p.classe}, ${p.personalita || 'senza personalità definita'}): HP ${p.hp}, energia ${p.energia}, livello ${p.livello} (xp ${p.xp}${p.punti_abilita_da_assegnare ? `, ${p.punti_abilita_da_assegnare} punti abilità da assegnare` : ''}), stato ${p.stato}, inventario: ${inv}`);
  });
  if (gameState.npc_presenti.length) {
    lines.push('NPC presenti nella scena:');
    gameState.npc_presenti.forEach((n) => {
      lines.push(`  - ${n.nome}${n.slug ? ` [ID: ${n.slug}]` : ''}${n.ostile ? ' (ostile, HP ' + n.hp + ')' : ''}: ${n.descrizione || ''}${n.relazione ? ' — relazione: ' + n.relazione : ''}`);
    });
  }
  const altriNpc = (gameState.npc_conosciuti || []).filter((n) => !gameState.npc_presenti.some((p) => p.slug === n.slug));
  if (altriNpc.length) {
    lines.push('Altri NPC già incontrati in precedenza (memoria, non sono qui ora — non contraddirli):');
    altriNpc.forEach((n) => {
      lines.push(`  - ${n.nome}${n.slug ? ` [ID: ${n.slug}]` : ''} — stato: ${n.stato}${n.relazione ? ', relazione: ' + n.relazione : ''}`);
    });
  }
  if (gameState.missioni_attive.length) {
    lines.push('Missioni:');
    gameState.missioni_attive.forEach((q) => lines.push(`  - [${q.tipo}] ${q.titolo} (${q.stato})`));
  }
  if (gameState.riassunto_precedente) {
    lines.push(`Riassunto capitolo precedente: ${gameState.riassunto_precedente.riassunto}`);
  }
  if (gameState.eventi_recenti?.length) {
    lines.push('Eventi recenti:');
    gameState.eventi_recenti.slice(-6).forEach((e) => lines.push(`  - ${e.testo}`));
  }
  return lines.join('\n');
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// =========================================================
// PARSING + VALIDAZIONE della risposta incollata dal giocatore
// =========================================================

/**
 * Divide il testo incollato in narrazione grezza + righe della sezione modifiche.
 */
function splitSections(rawText) {
  const text = rawText.trim();
  const modIndex = text.search(/⚙️?\s*MODIFICHE DA APPLICARE/i);
  if (modIndex === -1) {
    // Nessuna sezione modifiche riconosciuta: trattiamo tutto come narrazione.
    return { narration: stripNarrationHeader(text), changeLines: [] };
  }
  const narrationPart = stripNarrationHeader(text.slice(0, modIndex).trim());
  const changesPart = text.slice(modIndex).replace(/⚙️?\s*MODIFICHE DA APPLICARE/i, '').trim();
  const changeLines = changesPart.split('\n').map((l) => l.trim()).filter(Boolean);
  return { narration: narrationPart, changeLines };
}

function stripNarrationHeader(text) {
  return text.replace(/^📖?\s*NARRAZIONE\s*\n?/i, '').trim();
}

/**
 * Analizza e valida le modifiche contro lo stato reale della partita.
 * NON scrive nulla: restituisce solo un'anteprima con changes[].valid.
 */
export function parseAndValidateChanges(rawText, gameState, allLocations) {
  const { narration, changeLines } = splitSections(rawText);
  const changes = [];

  for (const line of changeLines) {
    const match = line.match(/^([A-ZÀ-Ù][A-ZÀ-Ù \d]*?)\s*:\s*(.+)$/i);
    if (!match) continue; // riga non riconosciuta, la ignoriamo silenziosamente
    const rawKey = match[1].trim().toUpperCase();
    const value = match[2].trim();
    if (/^(nessuno|invariat[ao]|-)$/i.test(value)) continue;

    if (rawKey === 'POSIZIONE') {
      changes.push(validatePositionChange(value, gameState, allLocations));
    } else if (rawKey.startsWith('HP')) {
      changes.push(validateHpChange(rawKey, value, gameState));
    } else if (rawKey.startsWith('ENERGIA')) {
      changes.push(validateEnergyChange(rawKey, value, gameState));
    } else if (rawKey.startsWith('XP')) {
      changes.push(validateXpChange(rawKey, value, gameState));
    } else if (rawKey === 'FAMA') {
      changes.push(validateFameChange(value, gameState));
    } else if (rawKey === 'OGGETTO AGGIUNTO') {
      changes.push(validateItemChange('add', value, gameState));
    } else if (rawKey === 'OGGETTO RIMOSSO') {
      changes.push(validateItemChange('remove', value, gameState));
    } else if (rawKey === 'EQUIPAGGIA') {
      changes.push(validateEquipChange(value, gameState));
    } else if (rawKey === 'RIMUOVI EQUIPAGGIAMENTO') {
      changes.push(validateUnequipChange(value, gameState));
    } else if (rawKey === 'MISSIONE') {
      changes.push(validateQuestChange(value, gameState));
    } else if (rawKey === 'NPC') {
      changes.push(validateNpcChange(value, false));
    } else if (rawKey === 'NEMICO') {
      changes.push(validateNpcChange(value, true));
    } else if (rawKey === 'SCENA') {
      changes.push(validateSceneChange(value));
    } else if (rawKey === 'EVENTO') {
      changes.push({ type: 'event', valid: true, description: `📜 Evento: ${value}`, payload: { text: value } });
    }
  }

  return { narration, changes };
}

function validatePositionChange(value, gameState, allLocations) {
  const target = value.includes('→') ? value.split('→').pop().trim() : value.trim();
  if (!target) return invalid('position', 'Nome del nuovo luogo mancante.');
  const existing = allLocations.find(
    (l) => (l.slug && l.slug.toLowerCase() === target.toLowerCase()) || l.name.toLowerCase() === target.toLowerCase()
  );
  return {
    type: 'position',
    valid: true,
    description: `📍 Posizione: ${gameState.luogo_corrente?.nome || 'sconosciuta'} → ${existing ? existing.name : target}`,
    payload: { targetName: existing ? existing.name : target, existingLocationId: existing?.id || null },
  };
}

function validateHpChange(rawKey, value, gameState) {
  const nameMatch = rawKey.replace(/^HP\s*/, '').trim();
  const character = matchCharacter(nameMatch, gameState);
  if (!character) {
    return invalid('hp', `Personaggio non riconosciuto in "${rawKey}: ${value}".`);
  }

  const [curHp, maxHp] = character.hp.split('/').map(Number);
  const signed = value.match(/^([+-])\s*(\d+)$/);
  const plain = value.match(/^(\d+)$/);

  if (signed) {
    const delta = (signed[1] === '-' ? -1 : 1) * Number(signed[2]);
    const newHp = Math.max(0, Math.min(maxHp, curHp + delta));
    return {
      type: 'hp',
      valid: true,
      description: `❤️ HP di ${character.nome}: ${curHp} → ${newHp}`,
      payload: { gameCharacterId: character.game_character_id, delta },
    };
  }

  if (plain) {
    const absolute = Number(plain[1]);
    if (absolute > maxHp) {
      return invalid('hp', `HP proposti per ${character.nome} (${absolute}) superano il massimo (${maxHp}): modifica rifiutata.`);
    }
    return {
      type: 'hp',
      valid: true,
      description: `❤️ HP di ${character.nome}: ${curHp} → ${absolute}`,
      payload: { gameCharacterId: character.game_character_id, delta: absolute - curHp },
    };
  }

  return invalid('hp', `Valore HP non riconosciuto: "${value}".`);
}

function validateEnergyChange(rawKey, value, gameState) {
  const nameMatch = rawKey.replace(/^ENERGIA\s*/, '').trim();
  const character = matchCharacter(nameMatch, gameState);
  if (!character) return invalid('energy', `Personaggio non riconosciuto in "${rawKey}: ${value}".`);

  const [curEnergy, maxEnergy] = character.energia.split('/').map(Number);
  const signed = value.match(/^([+-])\s*(\d+)$/);
  const plain = value.match(/^(\d+)$/);

  if (signed) {
    const delta = (signed[1] === '-' ? -1 : 1) * Number(signed[2]);
    const newEnergy = Math.max(0, Math.min(maxEnergy, curEnergy + delta));
    return {
      type: 'energy',
      valid: true,
      description: `⚡ Energia di ${character.nome}: ${curEnergy} → ${newEnergy}`,
      payload: { gameCharacterId: character.game_character_id, delta },
    };
  }

  if (plain) {
    const absolute = Number(plain[1]);
    if (absolute > maxEnergy) {
      return invalid('energy', `Energia proposta per ${character.nome} (${absolute}) supera il massimo (${maxEnergy}): modifica rifiutata.`);
    }
    return {
      type: 'energy',
      valid: true,
      description: `⚡ Energia di ${character.nome}: ${curEnergy} → ${absolute}`,
      payload: { gameCharacterId: character.game_character_id, delta: absolute - curEnergy },
    };
  }

  return invalid('energy', `Valore energia non riconosciuto: "${value}".`);
}

function validateXpChange(rawKey, value, gameState) {
  const nameMatch = rawKey.replace(/^XP\s*/, '').trim();
  const character = matchCharacter(nameMatch, gameState);
  if (!character) return invalid('xp', `Personaggio non riconosciuto in "${rawKey}: ${value}".`);

  const match = value.match(/^\+?(\d+)$/);
  if (!match) return invalid('xp', `Valore XP non riconosciuto: "${value}" (usa un numero, es. +20).`);

  const gained = Number(match[1]);
  return {
    type: 'xp',
    valid: true,
    description: `⭐ ${character.nome} guadagna ${gained} XP`,
    payload: { gameCharacterId: character.game_character_id, delta: gained },
  };
}

function validateEquipChange(value, gameState) {
  const match = value.match(/^(.+?)\s*\(([^)]+)\)\s*(?:→|:)\s*(armatura|amuleto)\s*$/i);
  if (!match) {
    return invalid('equip', `Formato non riconosciuto: "${value}" (serve "oggetto (Nome) → slot", slot = armatura o amuleto).`);
  }
  const itemName = match[1].trim();
  const character = matchCharacter(match[2].trim(), gameState) || gameState.personaggi[0];
  const slot = match[3].toLowerCase();

  if (!character) return invalid('equip', 'Nessun personaggio a cui equipaggiare l\'oggetto.');
  const item = character.inventario.find((i) => i.nome.toLowerCase() === itemName.toLowerCase());
  if (!item) return invalid('equip', `${character.nome} non possiede "${itemName}": impossibile equipaggiarlo.`);

  return {
    type: 'equip',
    valid: true,
    description: `🛡️ ${character.nome} equipaggia ${itemName} (${slot})`,
    payload: { gameCharacterId: character.game_character_id, inventoryId: item.id, itemName, slot },
  };
}

function validateUnequipChange(value, gameState) {
  const match = value.match(/^(armatura|amuleto)\s*\(([^)]+)\)\s*$/i);
  if (!match) {
    return invalid('unequip', `Formato non riconosciuto: "${value}" (serve "slot (Nome)", slot = armatura o amuleto).`);
  }
  const slot = match[1].toLowerCase();
  const character = matchCharacter(match[2].trim(), gameState) || gameState.personaggi[0];
  if (!character) return invalid('unequip', 'Nessun personaggio a cui togliere l\'equipaggiamento.');

  const item = character.inventario.find((i) => i.equipaggiato === slot);
  if (!item) return invalid('unequip', `${character.nome} non ha nulla equipaggiato nello slot ${slot}.`);

  return {
    type: 'unequip',
    valid: true,
    description: `🛡️ ${character.nome} toglie l'equipaggiamento da ${slot}`,
    payload: { gameCharacterId: character.game_character_id, inventoryId: item.id, slot },
  };
}

const FAME_MIN = -100;
const FAME_MAX = 100;

function validateFameChange(value, gameState) {
  const signed = value.match(/^([+-])\s*(\d+)$/);
  if (!signed) return invalid('fame', `Valore fama non riconosciuto: "${value}" (usa un delta con segno, es. +5 o -3).`);

  const delta = (signed[1] === '-' ? -1 : 1) * Number(signed[2]);
  const current = gameState.fama ?? 0;
  const newFame = Math.max(FAME_MIN, Math.min(FAME_MAX, current + delta));

  return {
    type: 'fame',
    valid: true,
    description: `🏆 Fama del gruppo: ${current} → ${newFame}`,
    payload: { delta },
  };
}

function validateItemChange(direction, value, gameState) {
  const nameMatch = value.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  const itemName = (nameMatch ? nameMatch[1] : value).trim();
  const characterHint = nameMatch ? nameMatch[2].trim() : null;
  const character = matchCharacter(characterHint, gameState) || gameState.personaggi[0];

  if (!character) return invalid('item', 'Nessun personaggio a cui assegnare l\'oggetto.');

  if (direction === 'remove') {
    const has = character.inventario.some((i) => i.nome.toLowerCase() === itemName.toLowerCase());
    if (!has) {
      return invalid('item', `${character.nome} non possiede "${itemName}": rimozione ignorata.`);
    }
  }

  return {
    type: direction === 'add' ? 'item_add' : 'item_remove',
    valid: true,
    description: `🎒 ${direction === 'add' ? 'Oggetto aggiunto' : 'Oggetto rimosso'} (${character.nome}): ${itemName}`,
    payload: { gameCharacterId: character.game_character_id, itemName },
  };
}

function validateQuestChange(value, gameState) {
  const parts = value.split('→');
  const title = (parts.length > 1 ? parts[0] : value.split(':')[0] || value).trim();
  const statusRaw = (parts.length > 1 ? parts[1] : '').trim().toLowerCase();
  const status = QUEST_STATUS_SYNONYMS[statusRaw] || null;

  const existing = gameState.missioni_attive.find((q) => q.titolo.toLowerCase() === title.toLowerCase());

  if (!status && !existing) {
    return invalid('quest', `Missione "${title}" non riconosciuta e nessuno stato valido indicato.`);
  }

  return {
    type: 'quest',
    valid: true,
    description: `📜 Missione: ${title} → ${status || 'attiva (nuova)'}`,
    payload: { title, status: status || 'attiva', isNew: !existing },
  };
}

function extractImageToken(str) {
  const match = str.match(/\(\s*img\s*:\s*([^)]+?)\s*\)/i);
  if (!match) return { cleaned: str, imagePath: null };
  return { cleaned: str.replace(match[0], '').replace(/\s{2,}/g, ' ').trim(), imagePath: match[1].trim() };
}

function validateNpcChange(value, isEnemy) {
  const arrow = value.includes('→') ? value.split('→') : value.split(':');
  let namePart = (arrow[0] || value).trim();
  const description = (arrow.slice(1).join(':') || '').trim();

  const { cleaned, imagePath } = extractImageToken(namePart);
  namePart = cleaned;

  if (!isEnemy) {
    const name = namePart.trim();
    if (!name) return invalid('npc', 'Nome NPC mancante.');
    return {
      type: 'npc',
      valid: true,
      description: `✦ NPC: ${name}${description ? ' — ' + description : ''}${imagePath ? ' 🖼️' : ''}`,
      payload: { name, description, imagePath },
    };
  }

  const hpMatch = namePart.match(/^(.+?)\s*\(\s*HP\s*:?\s*(\d+)\s*\)\s*$/i);
  const name = (hpMatch ? hpMatch[1] : namePart).trim();
  const hp = hpMatch ? Number(hpMatch[2]) : 10;
  if (!name) return invalid('enemy', 'Nome nemico mancante.');

  return {
    type: 'enemy',
    valid: true,
    description: `⚔ Nemico: ${name} (HP ${hp})${description ? ' — ' + description : ''}${imagePath ? ' 🖼️' : ''}`,
    payload: { name, hp, description, imagePath },
  };
}

function validateSceneChange(value) {
  const scene = value.trim().toLowerCase();
  if (!VALID_SCENES.includes(scene)) {
    return invalid('scene', `Tipo di scena non riconosciuto: "${value}".`);
  }
  return {
    type: 'scene',
    valid: true,
    description: `🎭 Scena: ${scene}`,
    payload: { sceneType: scene },
  };
}

function matchCharacter(nameHint, gameState) {
  if (!nameHint) return null;
  const clean = nameHint.trim().toLowerCase();
  return gameState.personaggi.find((p) => p.nome.toLowerCase() === clean || clean.includes(p.nome.toLowerCase()));
}

function invalid(type, reason) {
  return { type, valid: false, description: `⚠️ Ignorata: ${reason}`, payload: null };
}
