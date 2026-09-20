# 🐱 Il Regno dei Gatti — GDR narrativo con GM IA esterna

Un gioco di ruolo per 2 (o più) giocatori, ambientato in un mondo di gatti.
**Il programma è il motore del gioco** (dadi, statistiche, HP, inventario,
missioni, luoghi, salvataggi). **La narrazione è affidata a un'IA a tua
scelta** (ChatGPT, Gemini, Claude, o qualunque altra): non è integrata nel
programma, la usi tu, esternamente, copiando e incollando due testi per
turno.

```
gdr-gatti/
├── start.js                ← avvio automatico di tutto (npm start)
├── package.json             ← solo per il comando "npm start"
├── database/
│   └── schema.sql        ← tabelle + Row Level Security per Supabase
├── server/                ← backend Node/Express (motore del gioco)
│   ├── .env.example
│   ├── package.json
│   └── src/
│       ├── index.js
│       ├── config/supabase.js
│       ├── middleware/auth.js
│       ├── services/
│       │   ├── ruleEngine.js      ← d20, difficoltà, prove
│       │   ├── gameStateService.js← memoria di gioco + uniche scritture DB
│       │   └── aiBridge.js        ← costruisce il testo per l'IA e valida ciò che incolli
│       └── routes/
│           ├── characters.js
│           ├── games.js           ← partite + mappa modificabile
│           └── actions.js         ← tiri, copia-per-IA, importa-modifiche
└── client/                 ← frontend statico (HTML + CSS + JS, nessun build)
    ├── index.html
    ├── styles.css          ← design "regale"
    ├── audio.js            ← effetti sonori sintetizzati (nessun file audio)
    ├── config.js
    └── app.js
```

## Come funziona (l'idea centrale)

Il programma **non parla mai con nessuna IA**. Il flusso è:

1. Scrivi cosa vuoi fare: *"Milo prova a saltare sul tetto."*
2. Se l'azione è rischiosa, spunti "Serve una prova?", scegli chi agisce,
   quale statistica e quanto è difficile, e premi **🎲 Tira il dado**.
   Il tiro è vero, generato dal programma (non dall'IA).
3. Premi **📋 Copia per l'IA**: il programma prepara un testo con l'azione,
   il risultato del tiro (se c'è) e lo stato attuale della partita, e lo
   mette negli appunti.
4. Incolli quel testo nella tua IA preferita (ChatGPT, Gemini, ecc.).
5. L'IA risponde con una **NARRAZIONE** e una sezione **MODIFICHE DA
   APPLICARE** (il programma le chiede in un formato preciso, incluso nel
   testo copiato — la tua IA lo seguirà).
6. Incolli la risposta dell'IA nel riquadro "📥 Incolla la risposta della
   tua IA" e premi **Analizza**.
7. Il programma mostra un'**anteprima** di ogni modifica proposta (posizione,
   HP, oggetti, missioni...), **validata contro lo stato reale**: se l'IA
   propone qualcosa di impossibile (es. HP oltre il massimo, un oggetto che
   il personaggio non ha), quella riga viene mostrata come ⚠️ ignorata e
   NON verrà applicata.
8. Premi **Applica**: solo le modifiche valide vengono salvate su Supabase.

Il programma **non si fida mai ciecamente** del testo incollato: lo tratta
sempre come input da parsare e validare, mai come comandi diretti al database.

## 1. Crea il progetto Supabase

1. Vai su https://supabase.com, crea un account gratuito e poi **New project**.
2. Scegli un nome, una password per il DB (salvala da parte) e una regione vicina a te.
3. Quando il progetto è pronto, vai su **Project Settings → API**. Ti servono tre valori:
   - **Project URL** → `SUPABASE_URL`
   - **anon public key** → `SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ tienila segreta, non finisce mai nel frontend)
4. Vai su **SQL Editor → New query**, incolla tutto il contenuto di `database/schema.sql` ed esegui (▶ Run).
5. Vai su **Authentication → Providers** e assicurati che "Email" sia abilitato.

## 2. Avvio rapido (consigliato, dopo il primo setup)

Una volta creato il progetto Supabase (punto 1) e compilato `server/.env`
almeno una volta, non serve più ripetere tutti i passaggi manuali: dalla
cartella principale del progetto (quella con questo README) basta:

```bash
npm start
```

Questo comando (definito in `package.json` alla radice, esegue `start.js`):

1. controlla che `server/.env` esista — se manca lo crea dal modello e si
   ferma con istruzioni chiare (la prima volta in assoluto dovrai comunque
   aprirlo e incollare le tue chiavi Supabase, poi rilanciare `npm start`);
2. se `server/node_modules` manca, esegue `npm install` da solo;
3. avvia il backend;
4. serve il frontend con un piccolo server statico integrato (nessuna
   dipendenza esterna da installare per questo);
5. apre automaticamente il browser sul gioco;
6. con `Ctrl+C` chiude entrambi i server insieme.

Le sezioni 3 e 4 qui sotto restano utili se preferisci avviare backend e
frontend manualmente (es. per vedere i log separati, o capire cosa succede
dietro le quinte), ma con `npm start` non sono più necessarie giorno per
giorno.

## 3. Avvia il backend (manuale)

```bash
cd server
cp .env.example .env
```

Apri `server/.env` e compila:

```
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Non c'è nessuna chiave IA da configurare: il programma non ne ha bisogno.

```bash
npm install
npm run dev
```

Verifica:

```bash
curl http://localhost:3001/api/health
# {"ok":true,"service":"gdr-gatti-server"}
```

## 4. Avvia il frontend (manuale)

Apri `client/config.js` e inserisci `SUPABASE_URL` e `SUPABASE_ANON_KEY`
(la anon key è pensata per stare nel frontend, è protetta dalla Row Level
Security) e l'indirizzo del backend:

```js
window.APP_CONFIG = {
  SUPABASE_URL: 'https://<il-tuo-progetto>.supabase.co',
  SUPABASE_ANON_KEY: '<la-tua-anon-public-key>',
  API_BASE_URL: 'http://localhost:3001/api',
};
```

Poi servilo con un server statico qualsiasi, **sulla porta 3000** (deve
corrispondere a `CLIENT_ORIGIN` nel `.env` del backend):

```bash
cd client
npx serve -l 3000 .
```

oppure `python3 -m http.server 3000`. Apri `http://localhost:3000`.

## 5. Gioca

1. **Registrati/accedi** (email + password, gestito da Supabase Auth).
2. **🐱 Personaggi** → crea almeno un gatto (nome, descrizione, personalità,
   classe, 4 statistiche 0–3, HP).
3. **🐾 Nuova avventura** → wizard in 3 passi (titolo → tono → scelta dei
   gatti). Alla fine il programma crea la partita "vuota" e ti mostra subito
   un testo da copiare per generare l'apertura con la tua IA.
4. Copia quel testo, incollalo nella tua IA, copia la sua risposta, incollala
   nel riquadro di importazione, controlla l'anteprima, premi Applica.
5. Da qui in poi il ciclo è: scrivi azione → (eventuale tiro) → copia per IA
   → incolla risposta → analizza → applica. Ripeti.

### 🎲 Tiro libero

Il dado è sempre a portata di clic, sopra il campo "Cosa fate?": **non devi
più scrivere nulla prima di tirare**. Scegli chi tira, quale statistica e la
difficoltà, premi "🎲 Tira il dado" — il dado ruota con un'animazione, poi si
ferma sul numero vero (calcolato dal programma, mai inventato). Il colore e
l'animazione cambiano in base all'esito: verde per successo, rosso con una
scossa per fallimento, oro con un piccolo "salto" per un 20 naturale
(critico), rosso acceso con una scossa più forte per un 1 naturale
(fallimento critico).

Puoi tirare **senza scrivere nulla** nel campo azione: è pensato per quando
vuoi solo il numero e preferisci scrivere tu stesso, a voce o nella tua IA,
cosa stavi tentando — il tiro resta comunque salvato nella cronologia della
partita. Se invece scrivi anche l'azione, il pulsante "📋 Copia per l'IA"
prepara come sempre un testo completo pronto da incollare.

### Pulsanti della schermata di gioco

- **🗺️ Mappa** — luoghi scoperti, **modificabile**: puoi rinominare,
  descrivere, collegare due luoghi tra loro, aggiungerne di nuovi a mano, ed
  eliminarli. Se un luogo è collegato a quello attuale, appare un pulsante
  "🐾 Vai qui" per spostarti senza passare dall'IA.
- **🎒 Sacca** — inventario di ogni personaggio.
- **📖 Cronaca** — capitoli riassunti (quando ci saranno) + eventi recenti.
- **📋 Copia stato** — copia solo lo stato attuale (utile per "riallineare"
  la tua IA se hai aperto una nuova chat).
- **🎓 Istruisci l'IA** — copia le regole di formato (NARRAZIONE + MODIFICHE)
  insieme allo stato attuale. A differenza dell'apertura dell'avventura,
  questo pulsante funziona **in qualsiasi momento della partita**: usalo
  quando apri una chat nuova con la tua IA a metà partita, o se a un certo
  punto smette di seguire il formato richiesto e vuoi "ricordarglielo".
- **🔊 Suoni** — attiva/disattiva la musica d'ambiente, regola i volumi.

### Suoni

Tutti gli effetti (tiro di dado, successo, fallimento, sfoglio di pagina,
campanellino, cigolio di porta, un piccolo miagolio) e la musica d'ambiente
sono **generati al volo nel browser** con la Web Audio API: nessun file da
scaricare, nessuna questione di licenze, funziona anche offline. La musica
cambia leggermente "tensione" quando la scena passa a `combattimento` (lo
decide l'IA scrivendo `SCENA: combattimento` nelle modifiche).

## 6. Il formato che l'IA deve seguire

Il testo che copi per l'IA include già le istruzioni, ma in sintesi le chiedi
di rispondere sempre così:

```
📖 NARRAZIONE
(il racconto)

⚙️ MODIFICHE DA APPLICARE
POSIZIONE: <invariata oppure "vecchio luogo → nuovo luogo">
HP <NOME>: <delta con segno, es. -2, oppure "invariato">
OGGETTO AGGIUNTO: <nome oggetto (Nome personaggio) oppure "Nessuno">
OGGETTO RIMOSSO: <nome oggetto (Nome personaggio) oppure "Nessuno">
MISSIONE: <titolo → nuovo stato, oppure "invariata">
NPC: <nome> → <breve descrizione, oppure "Nessuno">
NEMICO: <nome> (HP:<numero>) → <breve descrizione, oppure "Nessuno">
SCENA: <esplorazione | dialogo | combattimento | puzzle | evento | viaggio | boss>
EVENTO: <una riga da ricordare, oppure "Nessuno">
```

Il programma riconosce queste righe (anche con qualche variazione di
formattazione) e valida ogni valore contro lo stato reale prima di
proporlo in anteprima:

- **HP**: se il valore è "delta" (`-2`, `+3`) viene sempre applicato e
  tenuto dentro i limiti [0, HP massimi]. Se è un numero assoluto senza
  segno (es. `100`) e supera gli HP massimi del personaggio, la riga viene
  **rifiutata**.
- **OGGETTO RIMOSSO**: se il personaggio non possiede davvero quell'oggetto,
  la riga viene **rifiutata**.
- **POSIZIONE**: se il luogo non esiste ancora, viene **creato** e collegato
  automaticamente al luogo precedente (la mappa si costruisce da sola man
  mano che esplorate, oltre a poterla modificare a mano).
- **MISSIONE**: se il titolo non corrisponde a nessuna missione esistente,
  ne viene creata una nuova (secondaria, attiva).
- **NPC / NEMICO**: creano o aggiornano un NPC per nome (senza distinguere
  maiuscole/minuscole) nel luogo attuale — è così che un personaggio nuovo
  o un nemico diventano visibili nella scena (vedi sezione 8). `NEMICO`
  imposta anche `is_hostile = true` e gli HP indicati tra parentesi
  (default 10 se il numero manca).

## 7. Sicurezza — checklist

- [x] `SUPABASE_SERVICE_ROLE_KEY` esiste solo in `server/.env`, mai nel frontend.
- [x] Nessuna chiave IA da proteggere: il programma non ne usa.
- [x] Ogni route che tocca una partita passa da `requireGameMembership`.
- [x] Il testo incollato dall'IA non scrive mai direttamente sul database:
      passa sempre da `parseAndValidateChanges` (analisi) e poi da
      `apply-changes` (che applica SOLO le righe marcate `valid: true`).
- [x] Row Level Security abilitata su tutte le tabelle di partita.

## 8. Scena visiva, aspetto e mondo vivo (FASE 1-8 del piano di evoluzione grafica)

La schermata di gioco ora mostra, sopra la pergamena della narrazione, un
**palcoscenico visivo**: lo sfondo del luogo attuale e i medaglioni dei
personaggi/NPC presenti. Non sostituisce il testo, lo affianca.

- **Sfondo del luogo**: usa la colonna `locations.image_url` (già esistente
  nello schema, nessuna nuova tabella). Se un luogo non ha un'immagine, viene
  mostrata una sfumatura scelta automaticamente in base a parole chiave nel
  nome (es. "Foresta Oscura" → verde scuro, "Castello" → viola regale) — mai
  un errore o un'immagine rotta.
- **Personaggi e NPC in scena**: usano `characters.avatar_url` e
  `npcs.avatar_url` (anche queste colonne già esistenti). Se manca
  un'immagine, compare un medaglione con l'iniziale del nome, come nella
  striscia dei personaggi.
- **Quali NPC compaiono in scena**: per ora, senza aggiungere colonne nuove
  al database, un NPC compare visivamente se ha un'immagine assegnata oppure
  se è ostile (`is_hostile`). Gli altri restano solo testuali, come prima.
- **Dove impostare le immagini**: nel modal 🗺️ Mappa puoi incollare l'URL
  dello sfondo per ogni luogo (anche per uno nuovo); nella creazione del
  personaggio c'è un campo "Immagine (URL)".
- **Asset locali**: `client/assets/` è già organizzata in `cats/`, `npcs/`,
  `locations/`, `ui/`, `effects/`, `music/`, `sfx/`. Se metti un file lì
  (es. `client/assets/locations/foresta.jpg`), puoi usarlo come URL
  incollando il percorso relativo `assets/locations/foresta.jpg` nel campo
  immagine — ricordati di servire la cartella `client/` intera con il server
  statico perché il percorso funzioni.

> 💡 **Se avevi già eseguito `schema.sql` prima di questa versione**: puoi
> semplicemente rieseguirlo tutto nel SQL Editor di Supabase, è scritto per
> essere sicuro da rilanciare (`create table if not exists`, `add column if
> not exists`). Oppure, se preferisci il minimo indispensabile, esegui solo:
> `alter table characters add column if not exists appearance jsonb not null default '{}';`

### Aspetto del gatto senza immagine (FASE 3)

Nella creazione del personaggio, sotto gli HP, trovi un pannello "Aspetto"
con 5 menu (pelo, occhi, vestiti, arma, accessorio) e un'anteprima dal vivo.
Se non carichi un'immagine (`avatar_url`), questa combinazione viene usata
per disegnare un medaglione riconoscibile: colore di sfondo per il pelo,
colore del bordo per i vestiti, un puntino colorato per gli occhi, due
piccoli distintivi per arma e accessorio. Tutto fatto con CSS, nessun file
immagine necessario — pensato per essere sostituito in futuro da vere
immagini a strati senza cambiare `characters.appearance` (il JSON salvato
resta identico, cambia solo come viene disegnato).

Se hai già personaggi creati prima di questa fase, non serve fare nulla:
`appearance` di default è `{}` e il medaglione mostrerà semplicemente
l'iniziale del nome, come prima.

### NPC visivi completi (FASE 4)

Prima di questa fase la tabella `npcs` esisteva ma non c'era alcun modo di
popolarla dal gioco vero e proprio. Ora il formato delle modifiche (sezione
5) include `NPC:` e `NEMICO:`: quando li usi, il programma crea o aggiorna
davvero un NPC nel luogo attuale, con descrizione ed eventualmente HP se è
ostile. Un NPC compare visivamente nel palcoscenico se ha un'immagine
assegnata oppure se è ostile — esattamente come deciso in FASE 1, solo che
ora esiste un modo reale per farli comparire.

In scena, **clicca un NPC** per vedere una piccola scheda con descrizione,
relazione con i giocatori e HP (se ostile). I personaggi giocanti non hanno
questa scheda: restano quelli gestiti dalla striscia sotto la scena.

### Minimappa (FASE 5)

Il pulsante "🧭 Minimappa" nella barra della schermata di gioco apre un
pannello compatto e richiudibile (anche su mobile) che mostra:

- il luogo attuale,
- i luoghi collegati direttamente, come pulsanti — cliccane uno per
  viaggiarci subito, senza passare dall'IA (usa la stessa rotta `/travel`
  già esistente),
- gli altri luoghi scoperti, in una riga informativa,
- i luoghi collegati ma **non ancora scoperti** come "❓ ???" (non
  cliccabili): per crearne uno, nel modal 🗺️ Mappa completo togli la
  spunta "Scoperto" quando aggiungi o modifichi un luogo. È un modo per
  "seminare" un indizio sulla mappa (es. un passaggio segreto sentito
  nominare ma mai visitato) senza svelarne subito il nome.

Non è una mappa tattica: nessuna coordinata, nessuna griglia, riusa
esattamente gli stessi dati (`/games/:id/locations`) del modal Mappa
completo, che resta il posto dove modificare davvero i luoghi.

### Eventi e overlay (FASE 6)

Quando applichi delle modifiche importate dall'IA, se tra le modifiche
valide compare un luogo nuovo, una missione nuova, un NPC nuovo, un nemico,
o la scena passa a "boss", vedrai comparire per un paio di secondi un
piccolo banner dorato sopra la scena (es. "✦ LUOGO SCOPERTO: Foresta
Oscura ✦", "⚔ NEMICO: Cane Ringhioso ⚔"). Sono puramente decorativi,
non bloccano l'interazione (puoi continuare a scrivere mentre sono visibili)
e scompaiono da soli.

### Dati "scena" opzionali dall'IA (FASE 7)

Il documento di progetto originale immaginava un formato JSON con una
proprietà opzionale `scene` (luogo, umore, personaggi, evento). Qui
l'architettura è testuale (copia/incolla), quindi lo stesso concetto è
realizzato con le righe opzionali `SCENA:`, `NPC:` e `NEMICO:` già descritte
in sezione 6: l'IA può includerle o no, e se una vecchia risposta non le
contiene il gioco continua a funzionare esattamente come prima (sono tutte
facoltative, proprio come richiesto).

### Animazioni e responsive (FASE 8)

Le figure in scena compaiono con una piccola animazione scaglionata (non
tutte insieme), il palcoscenico ha un fade quando cambi luogo, gli overlay
della FASE 6 scivolano dentro e fuori. Minimappa e banner eventi sono stati
verificati anche nella media query per schermi stretti già presente nel
progetto (sotto i 600px): niente scorrimento orizzontale, testo leggibile,
pulsanti che restano cliccabili.

## 9. Backup e versionamento con GitHub (facoltativo, ma consigliato)

Lo script `npm start` risolve "avviare tutto ogni volta"; GitHub risolve un
problema diverso, "non perdere il lavoro e poterlo vedere cambiare nel
tempo" — sono complementari, non alternativi. Consigliato farlo appena il
progetto ti sembra stabile:

```bash
cd gdr-gatti
git init
git add .
git commit -m "Prima versione: Il Regno dei Gatti"
```

`.env` (le tue chiavi Supabase) è già escluso automaticamente grazie al
`.gitignore` presente nel progetto — non finirà mai nel repository, nemmeno
per sbaglio.

Poi su https://github.com crea un repository vuoto (senza README, per non
avere conflitti con quello già presente) e collegalo:

```bash
git remote add origin https://github.com/<tuo-utente>/<nome-repo>.git
git branch -M main
git push -u origin main
```

Da lì in poi, ogni volta che fai modifiche importanti: `git add .`,
`git commit -m "descrizione"`, `git push`. Pubblicare il gioco online
(perché altri possano giocarci senza installare nulla) è un passo separato
e successivo — GitHub da solo serve "solo" a salvare/versionare il codice.

## 10. Mappa del Regno e Configura (Location / NPC)

Aggiornamento importante: se avevi già un progetto Supabase da prima di
questa versione, **riesegui `database/schema.sql`** nel SQL Editor (è
scritto per essere sicuro da rilanciare più volte: aggiunge solo le colonne
mancanti, non tocca i dati già presenti). Servono le nuove colonne
`slug`/`x`/`y`/`music_url` sulle location e `slug`/`fallback_image` sugli
NPC, più la nuova tabella `npc_locations`.

### ⚙️ Configura

Nuovo pulsante nella schermata di gioco. È il posto dove **prepari** i
luoghi e gli NPC dell'avventura senza mai dover aprire Supabase a mano:
due schede, "Location" e "NPC".

- **ID interno**: ogni location/NPC ha un identificatore stabile (es.
  `villaggio_dei_gatti`, `npc_giovanni`) che non cambia anche se rinomini
  il nome visualizzato. Se lo lasci vuoto viene generato automaticamente
  dal nome. È quello che l'IA può usare al posto del nome per riferirsi a
  un luogo o un NPC (vedi sezione 6: ora nello stato mandato all'IA compare
  come `[ID: ...]` accanto al nome, e sia POSIZIONE che NPC/NEMICO
  riconoscono l'ID oltre al nome).
- **Location**: nome, ID, descrizione, immagine di sfondo, musica/ambiente
  (il campo esiste già, il collegamento automatico luogo→musica non è
  ancora implementato, resta tra le semplificazioni), collegamento iniziale
  a un altro luogo (posiziona subito il nuovo nodo vicino a quello scelto),
  scoperto/non scoperto.
- **NPC**: nome, ID, descrizione, immagine, **immagine di riserva**
  (usata solo se manca quella principale), ostile/HP, e le location a cui è
  associato (per sapere dove potrebbe comparire — un NPC può essere
  associato a più luoghi, perché può viaggiare).

### 🗺️ Mappa del Regno

Non è più una lista: è un vero grafo a nodi.

- **Trascina** un nodo per spostarlo — la posizione si salva da sola
  (endpoint dedicato e leggero, pensato per essere chiamato spesso durante
  il trascinamento).
- **Trascina lo sfondo** per scorrere (pan), **rotellina del mouse** o
  **pizzico a due dita** su schermo touch per zoomare (ci sono anche i
  pulsanti ➕➖⤢ in alto a destra).
- Il luogo attuale ha un bordo dorato acceso e una coroncina 👑; i luoghi
  segnati come "non scoperti" in Configura appaiono come "❓ ???" invece
  del nome.
- I collegamenti sono linee leggermente curve tra i nodi — mai creati
  automaticamente solo perché due nodi sono vicini sullo schermo: solo le
  connessioni realmente salvate (create qui o dall'IA tramite `POSIZIONE`)
  vengono disegnate.
- Clic su un nodo (senza trascinarlo) apre una piccola scheda con nome,
  descrizione, un pulsante "🐾 Vai qui" se è collegato al luogo attuale, e
  "⚙️ Modifica in Configura" per aprirlo subito in modifica.
- Quando un nuovo luogo viene creato — sia da Configura sia dall'IA tramite
  `POSIZIONE` — il programma propone da solo una posizione vicino al luogo
  collegato (non sovrapposta agli altri nodi già lì); se poi lo sposti a
  mano, quella posizione non viene più ricalcolata automaticamente.
- Per collegare **due luoghi già esistenti** (non appena creati), apri
  Configura → Location → clicca il luogo → in basso trovi "Collega a un
  altro luogo già esistente".

### Come l'IA fa comparire un NPC ora

Il formato `NPC:`/`NEMICO:` (sezione 6) cerca prima una corrispondenza per
ID interno, poi per nome — quindi funziona sia se scrivi `npc_giovanni` sia
se scrivi semplicemente `Giovanni`. Se hai già configurato l'NPC in
Configura con un'immagine, quella viene usata in automatico: l'IA non deve
mai scrivere un percorso di file, solo il nome o l'ID.

### Correzione medaglioni

I medaglioni (lista personaggi, striscia in partita, scena) prima non
avevano NESSUNA regola di ridimensionamento per le immagini caricate:
potevano uscire dal cerchio o deformarsi. Ora `.medallion` e `.figure-avatar`
(le uniche due classi realmente usate, non ne sono state create di nuove)
ritagliano il contenuto al cerchio e mostrano l'immagine intera senza
deformarla (`object-fit: contain`).

## 11. Fama, livelli, energia, equipaggiamento

Altro aggiornamento con nuove colonne: **riesegui `database/schema.sql`**
(idempotente come sempre). Aggiunge `games.fame`, `locations.min_fame`,
energia/livelli/punti abilità su `game_characters`, `characters.base_energy`,
`inventory.equipped_slot`.

### 🏆 Fama del gruppo

Un solo valore condiviso da tutta la squadra (non per personaggio), da -100
a 100, mostrato nel badge in alto nella schermata di gioco. L'IA la
aggiorna con `FAMA: <delta con segno>` nel formato di sezione 6. Puoi dare
a un luogo (in Configura) una **fama minima richiesta**: se il gruppo non
ce l'ha, "🐾 Vai qui" resta bloccato sia sulla mappa sia sulla minimappa, e
il backend rifiuta comunque la richiesta anche se qualcuno prova a forzarla
via API (403).

### 📊 Dashboard, livelli e punti abilità

Nuovo pulsante "📊 Dashboard": una scheda per personaggio con barre di HP,
energia e progresso XP verso il prossimo livello (5 livelli, soglie
100/250/450/700 xp cumulativi). L'IA fa guadagnare XP con `XP <NOME>: +20`.

Ogni livello guadagnato sblocca un punto abilità. Quando succede, si apre
automaticamente la **pagina di assegnazione** (anche raggiungibile a mano
dalla Dashboard): scegli su quale delle 4 statistiche investirlo, +1 alla
volta, fino a un bonus massimo di +3 per statistica in questa partita (la
scheda "template" del personaggio, condivisibile tra partite diverse, non
viene mai toccata: il bonus vive solo su `game_characters`).

### ⚡ Energia

Stesso identico pattern degli HP, ma per mana/stamina. In creazione
personaggio trovi un campo "Energia massima" con un suggerimento automatico
in base alla classe scelta (es. Mago 30, Guerriero 10) — resta comunque
completamente modificabile a mano. L'IA la aggiorna con
`ENERGIA <NOME>: <delta con segno>`.

### 🛡️ Equipaggiamento nella Sacca

Due slot per personaggio: Armatura e Amuleto. Nel modal 🎒 Sacca ogni
oggetto non equipaggiato ha due pulsanti rapidi per indossarlo in uno slot;
un oggetto equipaggiato mostra "Togli". Funziona sia a mano (chiamata
diretta, senza bisogno dell'IA) sia tramite l'IA con le nuove righe:

```
EQUIPAGGIA: <nome oggetto> (Nome personaggio) → <armatura|amuleto>
RIMUOVI EQUIPAGGIAMENTO: <armatura|amuleto> (Nome personaggio)
```

Il backend rifiuta un `EQUIPAGGIA` se il personaggio non possiede davvero
quell'oggetto (stesso principio di validazione degli altri comandi).

### Memoria degli NPC (per non farli contraddire)

Lo stato mandato all'IA ora include anche gli NPC **non presenti nella
scena attuale** ma già incontrati in precedenza (nome, stato, relazione),
etichettati esplicitamente come "memoria, non contraddirli". Prima l'IA
vedeva solo gli NPC del luogo corrente e poteva perdere il filo su chi
avesse già incontrato, sconfitto o reso alleato altrove.

## 12. PWA — installabile con la sua icona

Il gioco è ora una Progressive Web App: `client/manifest.json` (nome, colori,
icone) + `client/sw.js` (service worker) + le icone in `client/assets/ui/`
(generate a tema, una piccola corona dorata su sfondo viola scuro).

Cosa significa in pratica:

- Da **desktop** (Chrome/Edge): apri il gioco nel browser, compare un'icona
  "Installa" nella barra degli indirizzi. Cliccandola, il gioco si apre
  come un'app a sé, con la sua icona, senza barra degli indirizzi del browser.
- Da **Android**: il browser propone "Aggiungi a schermata Home"; da quel
  momento l'icona sta sul telefono come qualsiasi altra app.
- Da **iPhone/iPad**: apri il gioco in Safari → pulsante Condividi →
  "Aggiungi a Home".

Il service worker mette in cache solo i file statici (HTML/CSS/JS/icone):
serve a far apparire l'interfaccia all'istante, **non** a giocare offline —
il gioco ha comunque bisogno del backend e di Supabase attivi per
funzionare davvero (login, salvataggi, azioni). Se cambi `app.js` o
`styles.css` dopo aver installato l'app, la versione in cache si aggiorna
da sola al prossimo caricamento (il service worker controlla sempre la
rete prima di arrendersi alla cache).

## 13. Farlo uscire dal tuo PC (hosting gratuito)

Finora tutto gira in locale: backend su `localhost:3001`, frontend su
`localhost:3000`. Per farci giocare anche da altrove (o da altre persone)
servono due hosting separati, entrambi gratuiti:

- **Backend** (deve restare "acceso" per rispondere alle chiamate) → **Render.com**
- **Frontend** (solo file statici) → **Netlify**
- **Database** → Supabase è già un servizio online: non deve spostarsi da
  nessuna parte, è già "fuori dal PC".

### Passo 1 — metti il codice su GitHub

Se non l'hai già fatto, segui la sezione 9 qui sopra: serve perché sia
Render sia Netlify si collegano direttamente a un repository GitHub.

### Passo 2 — backend su Render (gratis)

1. Vai su **https://render.com**, registrati (va bene anche con l'account GitHub).
2. **New +** → **Web Service** → collega il repository `gdr-gatti`.
3. Configura così:
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
4. In **Environment Variables** aggiungi le stesse tre variabili del tuo
   `server/.env` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
   `CLIENT_ORIGIN` per ora lascialo con un valore provvisorio, lo aggiorniamo al Passo 4.
5. **Create Web Service**. Dopo qualche minuto avrai un indirizzo tipo
   `https://gdr-gatti-backend.onrender.com`. Verificalo aprendo
   `https://gdr-gatti-backend.onrender.com/api/health` nel browser: deve
   rispondere `{"ok":true,...}`.

> ⚠️ Sul piano gratuito, Render "addormenta" il servizio dopo ~15 minuti
> senza richieste: la prima chiamata dopo una pausa impiega 30-60 secondi
> in più per svegliarsi. Normale, non è un errore — per un gioco personale
> è un compromesso accettabile per restare a costo zero.

### Passo 3 — frontend su Netlify (gratis)

1. Prima di pubblicarlo, apri `client/config.js` e imposta:
   ```js
   window.APP_CONFIG = {
     SUPABASE_URL: 'https://<il-tuo-progetto>.supabase.co',
     SUPABASE_ANON_KEY: '<la-tua-anon-public-key>',
     API_BASE_URL: 'https://gdr-gatti-backend.onrender.com/api', // l'indirizzo di Render dal Passo 2
   };
   ```
2. Vai su **https://netlify.com**, registrati (anche qui va bene l'account GitHub).
3. **Add new site** → **Import an existing project** → collega lo stesso
   repository GitHub.
4. Configura:
   - **Base directory**: `client`
   - **Build command**: *(lascia vuoto — non serve nessuna build)*
   - **Publish directory**: `client`
5. **Deploy**. Netlify ti dà un indirizzo tipo `https://gdr-gatti.netlify.app`
   (rinominabile gratis nelle impostazioni del sito, es. `il-regno-dei-gatti.netlify.app`).

### Passo 4 — chiudi il cerchio (CORS)

Torna su Render → il tuo servizio backend → **Environment** → aggiorna
`CLIENT_ORIGIN` con l'indirizzo Netlify vero (es.
`https://gdr-gatti.netlify.app`, **senza** slash finale) → salva (Render
riavvia da solo il servizio).

Senza questo passaggio il browser bloccherà le chiamate dal frontend
pubblicato al backend per motivi di sicurezza (lo stesso principio di
`localhost:3000`/`3001` in locale, sezione CORS già vista prima).

### Fatto

Apri l'indirizzo Netlify da qualunque dispositivo: è la stessa identica app
che avevi in locale, ora raggiungibile da ovunque, installabile come PWA
(sezione 12) con la sua icona. Il tuo PC può restare spento.

## 14. Risoluzione problemi comuni

### `ERR_NAME_NOT_RESOLVED` verso `xxxxxxxx.supabase.co`

Il browser sta cercando di raggiungere il **valore segnaposto**, quindi
`client/config.js` non contiene i tuoi dati reali.

Verifica decisiva: apri `https://tuo-sito.netlify.app/config.js` nel
browser. Vedi esattamente cosa riceve l'app. Se lì c'è `xxxxxxxx`, hai
trovato il problema.

La confusione tipica è questa — sono **tre cose separate**, non
comunicano tra loro:

| Dove | Chi lo legge | Cosa contiene |
|---|---|---|
| `server/.env` | solo il backend (Render) | tutte e 3 le chiavi, inclusa `service_role` |
| Variabili d'ambiente Netlify | solo la build, se ne usi una | niente, se non hai uno script che le usa |
| `client/config.js` | **il browser** | URL Supabase, anon key, indirizzo backend |

Soluzione: apri `client/config.js`, scrivici i valori veri, committa e
ripubblica. E lascia **vuoto** il "Build command" su Netlify: non serve
nessuna build, e uno script che genera `config.js` può facilmente
sovrascrivere quello giusto o fallire in silenzio.

> È normale e sicuro che `SUPABASE_ANON_KEY` finisca su GitHub: è
> progettata per essere pubblica, protetta dalle Row Level Security.
> La `service_role` key invece non deve mai stare in `config.js`.

### Ho aggiornato config.js ma il browser usa ancora i valori vecchi

Può essere il service worker che serve una versione in cache. Da questa
versione `config.js` è escluso dalla cache proprio per evitarlo, ma se hai
installato l'app prima dell'aggiornamento: apri gli strumenti sviluppatore
(F12) → **Application** → **Service Workers** → **Unregister**, poi
ricarica con Ctrl+Shift+R.

### Il login gira a vuoto o il backend non risponde

Su Render (piano gratuito) il servizio va in pausa dopo ~15 minuti di
inattività: la prima chiamata può metterci 30-60 secondi. Aspetta e
riprova. Per verificare che il backend sia vivo, apri direttamente
`https://tuo-backend.onrender.com/api/health`: deve rispondere
`{"ok":true,...}`.

### Errore CORS nella console

Il backend accetta chiamate solo dall'indirizzo in `CLIENT_ORIGIN`. Su
Render → Environment → `CLIENT_ORIGIN` deve contenere l'indirizzo Netlify
esatto, **senza slash finale** (es. `https://gdr-gatti.netlify.app`).

## 15. Fix di sicurezza (da una revisione esterna)

Una revisione del codice ha trovato alcuni problemi reali, corretti in
questa versione. Se avevi già pubblicato una versione precedente, **aggiorna
sia backend che frontend** con questa release.

### Critici — corretti

- **Nessun controllo che gli oggetti citati appartenessero alla partita.**
  `/apply-changes`, `/inventory/:id/equip`, `/inventory/:id/unequip` e
  `/characters/:id/allocate-skill` controllavano solo che tu fossi membro
  della partita nell'URL, ma non che il `gameCharacterId`/`inventoryId`
  dentro il corpo della richiesta appartenesse DAVVERO a quella partita. Nel
  flusso normale dell'interfaccia non si notava (gli ID arrivano sempre
  corretti), ma chiamando le API a mano si poteva modificare HP/energia/
  equipaggiamento di un personaggio di un'ALTRA partita a cui si partecipava.
  Ora ogni personaggio citato viene riverificato contro `game_id` prima di
  qualunque scrittura.
- **Creazione partita senza controllo del proprietario dei personaggi.**
  Si potevano passare ID di personaggi altrui e vederne la scheda (statistiche,
  descrizione, personalità) dentro una partita mai accettata dal vero
  proprietario. Aggiunto il filtro per `owner_id`.

### Importanti — corretti

- **Il ruolo proprietario/giocatore non contava nulla.** Chiunque fosse
  invitato in una partita poteva invitare altre persone, creare/modificare/
  eliminare luoghi e NPC in Configura, e leggere i campi degli NPC pensati
  per restare segreti solo per il master (`known_secrets`,
  `relationship_notes`). Ora queste azioni richiedono il ruolo
  "proprietario"; chi non lo è vede Configura in sola lettura, e i due campi
  segreti non vengono nemmeno mandati al browser di un giocatore semplice.

### Altri miglioramenti

- La libreria Supabase caricata da CDN ora è a **versione fissata** (2.45.4,
  la stessa del backend) con **hash di integrità**: se quel file su jsDelivr
  venisse mai alterato, il browser si rifiuta di eseguirlo.
- I messaggi d'errore mostrati al browser sono ora generici
  ("Impossibile creare il personaggio.") invece di inoltrare il testo grezzo
  degli errori del database — l'errore vero resta comunque nei log del
  server (`console.error`), utile per te in fase di debug ma non per un
  possibile malintenzionato.
- Aggiunto `client/_headers` per Netlify: una Content-Security-Policy di
  base e altri header (`X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`) che riducono i danni possibili se in futuro
  venisse mai introdotta una falla XSS.

### Non ancora fatto (non bloccante)

- **Rate limiting** su azioni ripetibili (tiri, inviti, creazione
  personaggi): non urgente per un gioco tra amici, ma economico da
  aggiungere in futuro con un limitatore per IP davanti a `/api`.
- Esegui **`npm audit`** dentro `server/` ogni tanto: alla stesura di
  questa nota le dipendenze erano tutte aggiornate, ma è bene ricontrollare
  periodicamente.
- Le regole già solide confermate dalla revisione (da non toccare): Row
  Level Security attiva su tutte le tabelle, testo dei giocatori sempre
  escapato prima di finire nella pagina, il parser delle risposte dell'IA
  tratta il testo incollato come non fidato e valida ogni modifica contro
  lo stato reale, i token JWT vengono verificati lato server.

## 16. Rotella di caricamento e correzione NPC casuali

### 🐱 Rotella di caricamento

Un gattino che sobbalza + tre zampette che si illuminano in sequenza,
compare da solo all'avvio dell'app (utile soprattutto per il primo
"risveglio" del backend su Render, che può metterci fino a un minuto) e
durante login/registrazione. Le didascalie sotto cambiano ogni paio di
secondi ("Il Regno si sveglia...", "Il maggiordomo-gatto si stiracchia...",
ecc.). Nessun asset esterno: solo emoji e CSS.

### Bug corretto: NPC che comparivano senza che l'IA li avesse mai citati

Causa trovata: nel calcolo dello stato della partita, se il luogo attuale
non era determinabile (**caso tipico: era stato eliminato da Configura**,
oppure per qualunque altro motivo `current_location_id` era rimasto vuoto),
il filtro "quali NPC sono nella scena" aveva una condizione che — invece di
non mostrare nessuno, per prudenza — mostrava **tutti** gli NPC attivi
della partita, indipendentemente da dove si trovassero davvero. Gli NPC
creati in Configura non hanno una posizione finché l'IA non li cita per la
prima volta (giustamente), quindi con quel bug finivano tutti in scena
insieme.

Corretto in tre punti, per sicurezza:
1. Il filtro ora, senza un luogo attuale certo, non mostra nessun NPC
   (comportamento sicuro) invece di mostrarli tutti.
2. **Non è più possibile eliminare il luogo in cui si trova attualmente il
   gruppo** da Configura — va prevenuto alla radice, così questa situazione
   non si può più ricreare.
3. Se nonostante tutto una partita restasse senza un luogo attuale (es. da
   prima di questo fix), il pulsante "🐾 Vai qui" ora funziona comunque per
   "ripartire" da un luogo qualsiasi, invece di restare bloccati.

Se la tua avventura in corso ha ancora questo problema: apri 🗺️ Mappa e
prova "🐾 Vai qui" su un qualunque luogo per riassegnare una posizione
attuale valida — da quel momento il filtro tornerà a funzionare come deve.

## Semplificazioni note (per le prossime fasi)

- La "Cronaca" mostra i capitoli riassunti già salvati (quando esisteranno)
  più gli eventi grezzi; una generazione automatica di un racconto in prosa
  completo è una fase futura.
- Le missioni create dal testo importato sono sempre "secondarie"; assegnare
  manualmente una missione come "principale" richiede per ora una modifica
  diretta su Supabase (una piccola interfaccia dedicata è una fase futura).
- Multiplayer in tempo reale (più utenti sulla stessa partita che vedono gli
  aggiornamenti l'uno dell'altro senza ricaricare) non è ancora incluso: oggi
  ogni giocatore deve ricaricare/riaprire la partita per vedere le modifiche
  applicate da un altro giocatore.
- La personalizzazione a livelli del gatto (pelo/occhi/vestiti/arma come
  immagini sovrapposte) è la FASE 3 del piano visivo e **ora è inclusa**, ma
  in una versione leggera: senza asset grafici reali, i "livelli" sono
  resi con CSS (colore di sfondo, bordo, due piccoli distintivi emoji)
  invece di immagini PNG sovrapposte. Funziona subito, senza bisogno di
  disegnare nulla, ed è pensata per essere sostituita in futuro da vere
  immagini a strati in `client/assets/cats/` senza cambiare la struttura
  dati (`characters.appearance` resta lo stesso JSON). Se un personaggio ha
  un'immagine (`avatar_url`), quella ha sempre la priorità sull'aspetto a
  livelli.
- La minimappa (FASE 5) e gli overlay per eventi importanti (FASE 6) **sono
  ora inclusi**; da questa versione il modal "🗺️ Mappa" è diventato il grafo
  a nodi puramente visivo (sezione 10) — per rinominare, collegare o
  segnare un luogo come non ancora scoperto si usa invece ⚙️ Configura.
- La musica non cambia ancora in base al singolo luogo (solo in base alla
  scena esplorazione/combattimento): collegarla al luogo è un'estensione
  piccola e naturale di `audio.js`, lasciata per un prossimo passo.
- Gli NPC creati con `NPC:`/`NEMICO:` si "spostano" nel luogo in cui vengono
  citati di nuovo (semplificazione: non tengono una posizione fissa propria
  se il testo li rinomina altrove); per un mondo con NPC stanziali in più
  luoghi contemporaneamente servirebbe un piccolo affinamento futuro.
- L'invito di un secondo giocatore a una partita esiste lato backend
  (`POST /api/games/:id/invite`) ma non ha ancora un pulsante nell'interfaccia:
  richiede di conoscere l'ID Supabase dell'altro utente. Una piccola UI di
  invito è un buon prossimo passo per il multiplayer reale.
- Le "location associate" di un NPC (in Configura) sono informative, per la
  preparazione del master: non limitano dove l'NPC può comparire nella
  scena — quello resta deciso dinamicamente da dove viene citato l'ultima
  volta (`npcs.location_id`), come già spiegato sopra.
- Sulla mappa i collegamenti tra due luoghi già esistenti si creano da un
  menu a tendina in Configura, non trascinando una linea da un nodo
  all'altro direttamente sul grafo: più semplice da implementare in modo
  affidabile, un'interazione "disegna una connessione" è un possibile
  miglioramento futuro.
