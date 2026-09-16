-- =========================================================
-- GDR DEI GATTI — Schema database Supabase (PostgreSQL)
-- =========================================================
-- Esegui questo file nell'SQL Editor di Supabase
-- (Project -> SQL Editor -> New query -> incolla ed esegui).
--
-- Filosofia: il backend (service role) è l'UNICO che scrive
-- stato di gioco (HP, inventario, dadi, quest...). L'IA non
-- tocca mai direttamente il database. Le RLS qui sotto
-- proteggono comunque i dati in caso di accesso diretto
-- dal client con la anon key (es. letture in tempo reale).
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- GAMES — una partita
-- ---------------------------------------------------------
create table if not exists games (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users(id) on delete cascade,
  title             text not null,
  tone              text not null default 'avventurosa', -- comica | avventurosa | misteriosa | assurda | epica
  setting           text,                                  -- breve descrizione ambientazione
  premise           text,                                  -- premessa generata dall'IA all'inizio
  main_quest_id     uuid,                                   -- riferimento a quests.id (aggiunto dopo)
  current_location_id uuid,                                 -- riferimento a locations.id (aggiunto dopo)
  current_scene_type text default 'esplorazione',           -- esplorazione | dialogo | combattimento | puzzle | evento | viaggio | boss
  status            text not null default 'attiva',         -- attiva | conclusa | abbandonata
  created_at        timestamptz not null default now(),
  last_active_at    timestamptz not null default now()
);

-- Fama del gruppo: un unico valore condiviso da tutti i giocatori della
-- partita (non per personaggio), che sale/scende in base alle loro azioni.
-- Nessun limite rigido nello schema: la clamp (-100..100) la fa l'applicazione.
alter table games add column if not exists fame integer not null default 0;

-- ---------------------------------------------------------
-- GAME_PLAYERS — chi partecipa a una partita (per il multiplayer)
-- ---------------------------------------------------------
create table if not exists game_players (
  game_id   uuid not null references games(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'giocatore', -- proprietario | giocatore
  joined_at timestamptz not null default now(),
  primary key (game_id, user_id)
);

-- ---------------------------------------------------------
-- CHARACTERS — scheda "modello" del gatto, riutilizzabile tra partite
-- ---------------------------------------------------------
create table if not exists characters (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  avatar_url   text,
  description  text,
  personality  text,
  class        text not null default 'Esploratore',
  forza        int not null default 1 check (forza between 0 and 3),
  agilita      int not null default 1 check (agilita between 0 and 3),
  astuzia      int not null default 1 check (astuzia between 0 and 3),
  coraggio     int not null default 1 check (coraggio between 0 and 3),
  base_hp      int not null default 20 check (base_hp > 0),
  created_at   timestamptz not null default now()
);

-- FASE 3 (personalizzazione visiva): aspetto a "livelli" del gatto, salvato
-- come JSON leggero invece di nuove tabelle/colonne per ogni caratteristica.
-- "add column if not exists" è idempotente: sicuro sia su schema nuovo che
-- su un database dove la tabella characters esiste già.
alter table characters add column if not exists appearance jsonb not null default '{}';
-- Energia massima "di base" del personaggio (mana/stamina): suggerita dalla
-- classe scelta in creazione, ma modificabile liberamente dal giocatore.
alter table characters add column if not exists base_energy int not null default 10;
-- Struttura attesa (tutte le chiavi opzionali):
-- { "fur": "arancione", "eyes": "verde", "clothes": "armatura", "weapon": "spada", "accessory": "campanellino" }

-- ---------------------------------------------------------
-- GAME_CHARACTERS — istanza di un personaggio DENTRO una partita
-- (HP correnti, livello, stato... cambiano per ogni partita)
-- ---------------------------------------------------------
create table if not exists game_characters (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references games(id) on delete cascade,
  character_id uuid not null references characters(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  current_hp   int not null,
  max_hp       int not null,
  level        int not null default 1 check (level between 1 and 5),
  xp           int not null default 0,
  status       text not null default 'in_forma', -- in_forma | ferito | esausto | svenuto | addormentato
  created_at   timestamptz not null default now(),
  unique (game_id, character_id)
);

-- Energia (mana/stamina): stesso pattern di current_hp/max_hp.
alter table game_characters add column if not exists current_energy int not null default 10;
alter table game_characters add column if not exists max_energy int not null default 10;
-- Punti abilità non ancora assegnati (sbloccati salendo di livello) e i bonus
-- alle 4 statistiche già assegnati in QUESTA partita (non tocca il "characters"
-- template, che resta riutilizzabile in altre partite invariato).
alter table game_characters add column if not exists skill_points int not null default 0;
alter table game_characters add column if not exists stat_bonuses jsonb not null default '{}';
-- Struttura attesa di stat_bonuses: {"forza": 1, "agilita": 0, "astuzia": 2, "coraggio": 0}

-- ---------------------------------------------------------
-- LOCATIONS — mappa narrativa (non tattica)
-- ---------------------------------------------------------
create table if not exists locations (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references games(id) on delete cascade,
  name        text not null,
  description text,
  image_url   text,
  discovered  boolean not null default true,
  connections jsonb not null default '[]', -- es. [{"to": "<location_id>", "label": "sentiero nel bosco"}]
  created_at  timestamptz not null default now()
);

-- ID interno stabile per i riferimenti dell'IA (non cambia se il "name" viene rinominato),
-- coordinate per la Mappa del Regno, e musica/ambiente opzionale del luogo.
alter table locations add column if not exists slug text;
alter table locations add column if not exists x double precision;
alter table locations add column if not exists y double precision;
alter table locations add column if not exists music_url text;
-- Fama minima del gruppo richiesta per potersi spostare qui manualmente
-- (facoltativa: NULL = nessuna restrizione). Vedi il vincolo applicato
-- dal backend nella rotta /travel.
alter table locations add column if not exists min_fame integer;
do $$ begin
  alter table locations add constraint locations_game_slug_unique unique (game_id, slug);
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------
-- NPCS — include anche i "nemici" (is_hostile = true) per non
-- moltiplicare le tabelle: un nemico è semplicemente un NPC ostile con HP.
-- ---------------------------------------------------------
create table if not exists npcs (
  id                uuid primary key default gen_random_uuid(),
  game_id           uuid not null references games(id) on delete cascade,
  name              text not null,
  description       text,
  personality       text,
  avatar_url        text,
  location_id       uuid references locations(id) on delete set null,
  relationship_notes text,        -- es. "odia Milo dopo il furto del pesce"
  known_secrets     text,         -- info che l'IA può rivelare solo se narrativamente giusto
  is_hostile        boolean not null default false,
  hp                int,          -- solo se is_hostile
  max_hp            int,
  difficulty        int,          -- soglia usata come "difesa" nei tiri contro di lui
  special_ability   text,
  status            text not null default 'attivo', -- attivo | sconfitto | fuggito | morto | alleato
  created_at        timestamptz not null default now()
);

-- ID interno stabile per i riferimenti dell'IA, e immagine di riserva
-- (usata se l'NPC non ha un'immagine propria configurata).
alter table npcs add column if not exists slug text;
alter table npcs add column if not exists fallback_image text;
do $$ begin
  alter table npcs add constraint npcs_game_slug_unique unique (game_id, slug);
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------
-- NPC_LOCATIONS — a quali luoghi un NPC è associato "in generale"
-- (per la preparazione del master in Configura). Distinto da npcs.location_id,
-- che invece indica dove si trova l'NPC ADESSO, nella scena corrente:
-- un NPC può essere associato a più luoghi (viaggia) ma è fisicamente
-- presente in uno solo alla volta.
-- ---------------------------------------------------------
create table if not exists npc_locations (
  npc_id      uuid not null references npcs(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  primary key (npc_id, location_id)
);

-- ---------------------------------------------------------
-- ITEMS — catalogo oggetti di una partita
-- ---------------------------------------------------------
create table if not exists items (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references games(id) on delete cascade,
  name         text not null,
  description  text,
  type         text not null default 'narrativo', -- consumabile | equipaggiamento | chiave | narrativo
  image_url    text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------
-- INVENTORY — cosa possiede ogni personaggio-in-partita
-- ---------------------------------------------------------
create table if not exists inventory (
  id               uuid primary key default gen_random_uuid(),
  game_character_id uuid not null references game_characters(id) on delete cascade,
  item_id          uuid not null references items(id) on delete cascade,
  quantity         int not null default 1 check (quantity >= 0),
  acquired_at      timestamptz not null default now(),
  unique (game_character_id, item_id)
);

-- Slot di equipaggiamento: NULL = nella sacca, non indossato.
-- Un solo oggetto per slot per personaggio (fatto rispettare dall'applicazione,
-- non da un vincolo SQL, perché richiede logica "libera lo slot precedente").
alter table inventory add column if not exists equipped_slot text;
-- Valori usati dall'applicazione: 'armatura' | 'amuleto' (facilmente estendibile).

-- ---------------------------------------------------------
-- QUESTS
-- ---------------------------------------------------------
create table if not exists quests (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references games(id) on delete cascade,
  title       text not null,
  description text,
  type        text not null default 'secondaria', -- principale | secondaria
  status      text not null default 'non_iniziata', -- non_iniziata | attiva | completata | fallita
  objectives  jsonb not null default '[]',           -- es. [{"text": "...", "done": false}]
  reward      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Le foreign key sono aggiunte in blocchi "do" idempotenti (come le unique
-- più sotto): sicuro rieseguire lo schema quante volte vuoi, anche se il
-- vincolo esiste già da un'esecuzione precedente.
do $$ begin
  alter table games
    add constraint fk_games_main_quest foreign key (main_quest_id) references quests(id) on delete set null;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table games
    add constraint fk_games_current_location foreign key (current_location_id) references locations(id) on delete set null;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------
-- GAME_EVENTS — log grezzo di ogni evento importante (memoria di sessione)
-- ---------------------------------------------------------
create table if not exists game_events (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references games(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null, -- null se evento generato dal sistema/IA
  event_type  text not null, -- player_action | ai_narration | dice_roll | quest_update | item_change | hp_change | npc_event | system
  content     text not null,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------
-- STORY_SUMMARIES — "capitoli" riassunti (memoria permanente compressa)
-- ---------------------------------------------------------
create table if not exists story_summaries (
  id             uuid primary key default gen_random_uuid(),
  game_id        uuid not null references games(id) on delete cascade,
  chapter_number int not null,
  title          text not null,
  summary        text not null,
  key_facts      jsonb not null default '[]', -- fatti importanti da ricordare sempre (relazioni, segreti, promesse...)
  created_at     timestamptz not null default now(),
  unique (game_id, chapter_number)
);

-- ---------------------------------------------------------
-- DICE_ROLLS — log dei tiri (mai inventati dall'IA)
-- ---------------------------------------------------------
create table if not exists dice_rolls (
  id               uuid primary key default gen_random_uuid(),
  game_id          uuid not null references games(id) on delete cascade,
  game_character_id uuid references game_characters(id) on delete set null,
  stat             text,        -- forza | agilita | astuzia | coraggio | null per tiri "puri"
  stat_value       int,
  raw_roll         int not null check (raw_roll between 1 and 20),
  total             int not null,
  difficulty       int not null,
  success          boolean not null,
  context          text,        -- breve descrizione dell'azione tentata
  created_at       timestamptz not null default now()
);

-- =========================================================
-- INDICI utili
-- =========================================================
create index if not exists idx_game_players_user on game_players(user_id);
create index if not exists idx_game_characters_game on game_characters(game_id);
create index if not exists idx_npcs_game on npcs(game_id);
create index if not exists idx_locations_game on locations(game_id);
create index if not exists idx_items_game on items(game_id);
create index if not exists idx_quests_game on quests(game_id);
create index if not exists idx_game_events_game_created on game_events(game_id, created_at desc);
create index if not exists idx_story_summaries_game on story_summaries(game_id, chapter_number);
create index if not exists idx_dice_rolls_game on dice_rolls(game_id, created_at desc);

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================

-- Funzione helper: l'utente corrente fa parte della partita?
create or replace function is_game_member(_game_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from game_players gp
    where gp.game_id = _game_id and gp.user_id = auth.uid()
  );
$$;

alter table games enable row level security;
alter table game_players enable row level security;
alter table characters enable row level security;
alter table game_characters enable row level security;
alter table locations enable row level security;
alter table npcs enable row level security;
alter table items enable row level security;
alter table inventory enable row level security;
alter table quests enable row level security;
alter table game_events enable row level security;
alter table story_summaries enable row level security;
alter table dice_rolls enable row level security;
alter table npc_locations enable row level security;

-- GAMES: visibili/modificabili solo ai membri; creazione libera (diventa owner)
drop policy if exists "games_select_members" on games;
create policy "games_select_members" on games for select
  using (is_game_member(id) or owner_id = auth.uid());
drop policy if exists "games_insert_owner" on games;
create policy "games_insert_owner" on games for insert
  with check (owner_id = auth.uid());
drop policy if exists "games_update_members" on games;
create policy "games_update_members" on games for update
  using (is_game_member(id) or owner_id = auth.uid());

-- GAME_PLAYERS: visibili ai membri della stessa partita; l'utente può aggiungersi/rimuoversi
drop policy if exists "game_players_select" on game_players;
create policy "game_players_select" on game_players for select
  using (is_game_member(game_id));
drop policy if exists "game_players_insert_self" on game_players;
create policy "game_players_insert_self" on game_players for insert
  with check (user_id = auth.uid());
drop policy if exists "game_players_delete_self" on game_players;
create policy "game_players_delete_self" on game_players for delete
  using (user_id = auth.uid());

-- CHARACTERS (modelli personali): solo il proprietario
drop policy if exists "characters_owner_all" on characters;
create policy "characters_owner_all" on characters for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Tutte le tabelle "figlie" di una partita: leggibili dai membri della partita.
-- Le SCRITTURE applicative passano dal backend con service role (bypassa RLS);
-- qui lasciamo comunque una policy di lettura per client realtime/anon.
drop policy if exists "game_characters_select" on game_characters;
create policy "game_characters_select" on game_characters for select
  using (is_game_member(game_id));
drop policy if exists "locations_select" on locations;
create policy "locations_select" on locations for select
  using (is_game_member(game_id));
drop policy if exists "npcs_select" on npcs;
create policy "npcs_select" on npcs for select
  using (is_game_member(game_id));
drop policy if exists "items_select" on items;
create policy "items_select" on items for select
  using (is_game_member(game_id));
drop policy if exists "quests_select" on quests;
create policy "quests_select" on quests for select
  using (is_game_member(game_id));
drop policy if exists "game_events_select" on game_events;
create policy "game_events_select" on game_events for select
  using (is_game_member(game_id));
drop policy if exists "story_summaries_select" on story_summaries;
create policy "story_summaries_select" on story_summaries for select
  using (is_game_member(game_id));
drop policy if exists "dice_rolls_select" on dice_rolls;
create policy "dice_rolls_select" on dice_rolls for select
  using (is_game_member(game_id));

-- INVENTORY: leggibile se sei membro della partita a cui appartiene il personaggio
drop policy if exists "inventory_select" on inventory;
create policy "inventory_select" on inventory for select
  using (
    exists (
      select 1 from game_characters gc
      where gc.id = inventory.game_character_id and is_game_member(gc.game_id)
    )
  );

-- NPC_LOCATIONS: leggibile se sei membro della partita a cui appartiene l'NPC
drop policy if exists "npc_locations_select" on npc_locations;
create policy "npc_locations_select" on npc_locations for select
  using (
    exists (
      select 1 from npcs n
      where n.id = npc_locations.npc_id and is_game_member(n.game_id)
    )
  );
