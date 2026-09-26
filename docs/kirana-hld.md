# Kirana Voice Billing — High-Level Design (HLD)

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│              Web App (Next.js App Router, Phase 1)      │
│                                                         │
│  ┌─────────────────┐   ┌─────────────────────────────┐ │
│  │   Billing UI    │   │      API Routes             │ │
│  │  - Live Table   │   │  /api/items (catalog)       │ │
│  │  - Hold-to-Talk │   │  /api/sessions (token/mgmt) │ │
│  │  - Earcons      │   │  (protected by SHOP_PIN)    │ │
│  └────────┬────────┘   └──────────────┬──────────────┘ │
└───────────┼───────────────────────────┼─────────────────┘
            │                           │
            │ wss://.../ws/live         │
            ▼                           │
┌───────────────────────────────────────┴─────────────────┐
│     Custom Node.js Server (server.ts / Cloud Run)       │
│                                                         │
│  - WebSocket Gateway (ws) with PIN authentication       │
│  - Web Audio PCM (16kHz 16-bit mono) stream pipe        │
│  - Gemini Live WebSocket Client (server-to-server)      │
│  - Tool Call Dispatcher (add_line_item, close_bill...)   │
│  - Deterministic Colloquial Quantity Parser             │
│  - Tiered Postgres Resolver (Exact -> Phonetic -> Trgm) │
└───────────────────────────┬─────────────────────────────┘
                            │ Service Role writes
                            ▼
┌─────────────────────────────────────────────────────────┐
│                   Supabase (Postgres)                   │
│                                                         │
│  - items (catalog, current_price)                       │
│  - item_aliases (pg_trgm index, unique aliases)         │
│  - price_history (audit log)                            │
│  - sessions (IST date, token_number, subtotal trigger)  │
│  - session_items (immutable price snapshot)             │
│                                                         │
│  ──▶ Supabase Realtime Broadcasts ──▶ All Tablet/Phone  │
│      (Single Source of Truth for Bill State)            │
└─────────────────────────────────────────────────────────┘
```

### Key Architectural Principles
1. **Deployment & Microphone Access**: Deployed directly to Google Cloud Run (containerized via Docker). Cloud Run provides native TLS (`https://` and `wss://`), satisfying browser `getUserMedia` security constraints for counter tablets without local certificate hurdles.
2. **Access Gate & Cost Protection**: Because the Cloud Run URL is publicly reachable, access is gated by a 4-digit `SHOP_PIN`. The tablet prompts once and saves it in `localStorage`. The server validates this secret on the WebSocket handshake (`wss://...?pin=...`) and on all API routes (`x-shop-pin` header) before touching the Gemini Live API or database.
3. **State Synchronization**: Supabase Realtime is the **single source of truth** for all bill row changes. When Gemini Live tool calls insert or edit rows, or when the shopkeeper tap-edits rows, the write hits Postgres and Realtime broadcasts the delta to all listening devices. The custom server's WebSocket is strictly an audio and control pipe.
4. **Latency & Observability**: Every voice turn logs end-to-end latency breakdowns: `Audio End -> Gemini Tool Call -> DB Resolution -> Postgres Commit -> Client Realtime Received`.

---

## 2. Enhanced Data Model (PostgreSQL / Supabase)

```sql
-- Enable trigram extension for fuzzy text matching
create extension if not exists pg_trgm;

-- 1. Items Catalog
create table items (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  unit_type text not null check (unit_type in ('kg', 'g', 'litre', 'piece', 'packet')),
  current_price numeric(10,2) not null check (current_price >= 0),
  category text,
  net_content numeric(10,3) null,
  net_content_unit text null check (net_content_unit in ('g', 'ml')),
  created_at timestamptz default now(),
  constraint chk_items_net_content check (
    (net_content is null and net_content_unit is null) or
    (net_content is not null and net_content_unit is not null)
  )
);

-- 2. Item Aliases (Spoken Hinglish variations)
create table item_aliases (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  alias_text text not null unique,
  created_at timestamptz default now()
);
create index item_aliases_trgm_idx on item_aliases using gin (alias_text gin_trgm_ops);

-- 3. Price History Audit Trail
create table price_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  old_price numeric(10,2) not null,
  new_price numeric(10,2) not null,
  changed_at timestamptz default now()
);

-- 4. Customer Sessions (Daily Sequential Tokens reset at IST Midnight)
create table sessions (
  id uuid primary key default gen_random_uuid(),
  session_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  customer_number int not null,
  status text not null default 'open' check (status in ('open', 'closed', 'resumed')),
  subtotal numeric(10,2) not null default 0.00,
  created_at timestamptz default now(),
  closed_at timestamptz,
  constraint uq_session_date_token unique (session_date, customer_number)
);

-- Atomic daily token generator
create or replace function get_next_customer_token(p_date date default (now() at time zone 'Asia/Kolkata')::date)
returns int language plpgsql as $$
declare
  next_token int;
begin
  select coalesce(max(customer_number), 0) + 1 into next_token
  from sessions
  where session_date = p_date;
  return next_token;
end;
$$;

-- 5. Bill Line Items (Snapshot at Add-Time)
create table session_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  item_id uuid not null references items(id),
  quantity numeric(10,3) not null,
  unit text not null,
  spoken_quantity_label text, -- e.g. "1 paav", "dhai-sau gram"
  unit_price_used numeric(10,2) not null, -- immutable snapshot at add-time
  is_price_override boolean default false,
  line_total numeric(10,2) not null,
  created_at timestamptz default now()
);

-- Subtotal trigger: keep sessions.subtotal strictly consistent
create or replace function sync_session_subtotal()
returns trigger language plpgsql as $$
declare
  v_session_id uuid;
begin
  v_session_id := coalesce(new.session_id, old.session_id);
  update sessions
  set subtotal = coalesce((select sum(line_total) from session_items where session_id = v_session_id), 0.00)
  where id = v_session_id;
  return null;
end;
$$;

create trigger trg_session_items_subtotal
after insert or update or delete on session_items
for each row execute function sync_session_subtotal();

-- Enable Supabase Realtime for live UI sync
alter publication supabase_realtime add table sessions, session_items;
```

---

## 3. Tiered Item Matching Resolver

3.1 Runtime topology `[decided]`
Single Node process (`server.ts`, port 3000): Next.js App Router + integrated `ws` server at `/ws/live`.
Browser streams 16 kHz 16-bit mono PCM only while hold-to-talk is held. Server proxies to Gemini Live (WSS, server-to-server). `GEMINI_API_KEY` never leaves the server.
Browser connects with a relative `wss://<host>/ws/live` (never hardcoded `ws://localhost`). Mic capture (`getUserMedia`) requires HTTPS or localhost, so tablet use requires a TLS-terminated deployment (see build-plan Step 6).
Source of truth for bill state = Supabase Realtime. The WS channel carries only audio, status (`listening | processing | ready`) and earcon cues (`ok | miss | ambiguous`). It does not carry row data. Rationale: avoids two overlapping state paths; makes later multi-device sync a no-op.
3.2 Session binding `[decided]`
The server holds the active session per WS connection. Tools do not take `session_id` (removed from the earlier draft; the model never sees or invents IDs).
Active session is set by: connection start (resume latest open session or create new), `open_session`, `start_new_bill`, or UI action.
All tool handlers resolve the session server-side and reject if none is active.
3.3 Function declarations
Changes vs. earlier HLD: `resolve_item` removed (folded into `add_line_item`, one DB transaction); `session_id` removed; `update_price` renamed `update_catalog_price`; `delete_row` added; `open_session` and `start_new_bill` added `[proposed]`.
```json
[
  {
    "name": "add_line_item",
    "description": "Append a priced line item to the active bill when the shopkeeper names an item and a quantity. Call once for each item in a multi-item burst.",
    "parameters": {
      "type": "object",
      "properties": {
        "item_name": { "type": "string", "description": "Spoken item name, romanized (e.g. 'chini', 'taaza chai', 'sarson tel')." },
        "quantity_text": { "type": "string", "description": "Raw spoken quantity phrase, romanized, unmodified (e.g. 'aadha kilo', '1 paav', 'dhai sau gram', '2 packet')." },
        "price_override": { "type": "string", "description": "Optional negotiated unit price phrase spoken specifically for this line item (e.g. '70 rupaye', 'rate 35', 'nabbe rupaye')." }
      },
      "required": ["item_name", "quantity_text"]
    }
  },
  {
    "name": "edit_last_line_item",
    "description": "Correct or delete the most recently added line on the active bill.",
    "parameters": {
      "type": "object",
      "properties": {
        "correction_type": { "type": "string", "enum": ["change_item", "change_quantity", "change_price", "delete_row"] },
        "new_value": { "type": "string", "description": "Spoken new value, romanized. Omit for delete_row." }
      },
      "required": ["correction_type"]
    }
  },
  {
    "name": "update_catalog_price",
    "description": "Permanently update an item's catalog price on an explicit rate-change command.",
    "parameters": {
      "type": "object",
      "properties": {
        "item_name": { "type": "string" },
        "new_price": { "type": "string", "description": "Spoken new price phrase, romanized (e.g. '75', 'pachattar', 'nabbe rupaye')." }
      },
      "required": ["item_name", "new_price"]
    }
  },
  {
    "name": "close_bill",
    "description": "Compute the total and close the active session on 'total batao' / 'bill complete'.",
    "parameters": { "type": "object", "properties": {} }
  },
  {
    "name": "open_session",
    "description": "[proposed] Reopen a session by today's token number, e.g. 'token 12 kholo'.",
    "parameters": {
      "type": "object",
      "properties": { "token_number": { "type": "integer" } },
      "required": ["token_number"]
    }
  },
  {
    "name": "start_new_bill",
    "description": "[proposed] Start a new customer session, e.g. 'naya bill'.",
    "parameters": { "type": "object", "properties": {} }
  }
]
```
3.4 System instruction
```text
You are a silent billing assistant at a kirana shop counter in Ranchi. The shopkeeper speaks Hinglish.
Rules:
1. On item + quantity, call add_line_item immediately. If the shopkeeper speaks multiple items in one utterance (e.g., 'chini aadha kilo, atta ek kilo, chai patti do packet'), emit one separate add_line_item call for each item/quantity pair.
2. Pass price_override only if a specific rate is quoted for this sale ('chini 70 rupaye me lagao', 'atta rate 35'). Attach each override only to the item it describes.
3. Corrections to the last row ("chini nahi, aata", "quantity 1 kilo karo", "wo hata do") -> edit_last_line_item.
4. "total batao" / "bill complete" -> close_bill.
5. "chini ka rate 75 karo" (permanent rate change) -> update_catalog_price. Never reinterpret a one-sale negotiated rate as a catalog update.
6. "token 12 kholo" -> open_session. "naya bill" -> start_new_bill.
7. Output item_name and quantity_text in Roman script (Hinglish), never Devanagari. Pass quantity_text exactly as spoken; do not convert or compute numbers.
8. Never speak; the screen is the response.
```
3.5 Server-side pipeline per `add_line_item` `[decided]`
`quantity_text` → deterministic parser (`lib/quantity-parser.ts`) → `{ quantity, base_unit, spoken_label, category }`. The model's numeric interpretation is never trusted.
`item_name` → alias resolver (`lib/item-resolver.ts`, `resolve_item_by_alias`) → item candidates.

**Pack-size conversion & unit compatibility rules:**
1. **Packaged SKU with `net_content`**:
   - If resolved item has `unit_type in ('packet', 'piece')` and `net_content` is NOT NULL:
     - Convert spoken amount and `net_content` to common base units (grams for weight, ml for volume).
     - Calculate packet multiplier: `n = spoken_amount / net_content`.
     - Integer check with ±1% tolerance: `Math.abs(n - Math.round(n)) / n <= 0.01`.
     - If within tolerance: `quantity = Math.round(n)` packets. Unit price used is the item's packet price (`current_price` or `price_override`). `spoken_quantity_label` records e.g. `"100g = 1 packet"` or `"200g = 2 packets"`.
     - If NOT an integer multiple (e.g. 150g on a 100g pack): reject with `unit_mismatch` status and descriptive message: `"Unit mismatch: Spoken 150g does not match 100g pack size for Haldi Powder 100g"`. Never round silently.
2. **Packaged SKU with NULL `net_content`**:
   - Return resolvable state `pack_size_missing` prompting a one-time inline form on the tablet to specify `net_content` and `net_content_unit` ('g' | 'ml'). On save, update `items` and automatically replay the pending line.
3. **Loose SKU sold per kg**:
   - Spoken count (e.g. "2 packet chini") is rejected with `unit_mismatch` as today.
4. **Tie-breaking between Loose and Packaged SKUs**:
   - When an alias matches both a loose SKU (e.g. "atta" loose kg) and a packaged SKU (e.g. "Aashirvaad Atta 5kg packet"):
     - Tie-break first by spoken unit family (weight/volume vs count).
     - If spoken as weight, check if spoken amount matches a packaged SKU's `net_content` or integer multiple.
     - If exactly one packaged SKU matches, select it; if multiple packaged SKUs match multiples (e.g. 200g matches 100g x2 and 200g x1), return `ambiguous` with candidate chips.
5. **Rounding & Line Total Calculation**:
   - `line_total = Math.round(quantity * unit_price_used * 100) / 100` (round half up to 2 decimal places).
   - Snapshot `unit_price_used` into `session_items`. Trigger `trg_session_items_subtotal` updates `sessions.subtotal`.

3.6 Tool-response contract & Unrecognized item flow `[decided]`
Every handler returns a structured object to the model and emits an earcon cue to the browser:
`status` | Meaning | Earcon | UI
--- | --- | --- | ---
`ok` | Row added/edited/closed | chime | Row appears via Realtime
`not_found` | No alias above threshold | two-tone warning | Unrecognized item card with 3 actions
`ambiguous` | Top-2 candidates within margin | two-tone warning | Candidate chips to pick from
`unit_mismatch` | Spoken unit incompatible / not pack multiple | two-tone warning | Inline warning banner with pack size details
`pack_size_missing` | Packaged item lacks net_content | two-tone warning | Inline prompt to set pack size & replay
`no_active_session` / `error` | Server-side failure | two-tone warning | Toast + retry

**Unrecognized Item Flow (`not_found`):**
- Server stores the pending utterance `{ raw_item_name, quantity_text, price_override, parsed_quantity, target_unit, spoken_label }` in-memory on the active connection / session context.
- UI displays an inline 3-action card within `components/AmbiguityBanner.tsx`:
  1. **"Same as an existing item"**: Displays top-3 fuzzy suggestions plus a search box over catalog items. On selection, sends `resolve_pending_item` WS message with `action: 'map_existing'`. Server upserts `alias_text -> item_id` into `item_aliases` (prompting confirmation if the alias already maps to a different item), shows a 5-second "Undo Mapping" toast, and immediately replays the pending line into `session_items`.
  2. **"Add as new item"**: Displays an inline form prefilled with the spoken name; suggests `unit_type` from the spoken unit (kg/g → kg, packet → packet, ml/litre → litre); requires `current_price`; requires `net_content` and `net_content_unit` if `unit_type` is packet/piece. On save, creates the item in `items`, inserts the alias into `item_aliases`, and automatically replays the pending line.
  3. **"Ignore"**: Discards the pending utterance.

3.7 Audio and activity handling `[decided]`
1. **Warm Audio Pipeline**:
   - Single acquisition of `getUserMedia`, `AudioContext`, and `AudioWorkletNode` (`/audio-worklet.js`) on the first user gesture.
   - Stream and audio graph remain warm; chunk forwarding to WebSocket is gated on press/release without teardown.
   - Gracefully handles tab visibility changes, device changes, and permission denial.
2. **Pre-Roll Ring Buffer**:
   - Browser recorder maintains a circular ring buffer of ~300ms of 16kHz PCM audio samples while idle.
   - On `mic_start`, the pre-roll buffer is prepended before newly incoming audio frames, ensuring the first syllable/word is never clipped.
3. **Release Tail & Worklet Flush Handshake**:
   - On release, continue capturing for a short tail of 300ms (`RELEASE_TAIL_MS = 300`).
   - Post `'flush'` to `workletNode.port` and await worklet flush acknowledgment (`{ type: 'flushed' }`).
   - Send final audio chunk, and ONLY THEN send `mic_stop` to the server. Ordering is strictly deterministic without `setTimeout` races.
4. **Manual Activity Signaling (Gemini Live Protocol)**:
   - *Reference*: Official Google Gemini Multimodal Live API Documentation (`ai.google.dev/api/multimodal-live` and `ai.google.dev/gemini-api/docs/multimodal-live`).
   - Setup message disables server-side VAD:
     ```json
     {
       "setup": {
         "model": "models/gemini-2.5-flash-native-audio-latest",
         "realtimeInputConfig": {
           "automaticActivityDetection": {
             "disabled": true
           }
         },
         "generationConfig": { "responseModalities": ["AUDIO"], "temperature": 0.1 },
         "systemInstruction": { ... },
         "tools": [ ... ]
       }
     }
     ```
   - On `mic_start`: Send `realtimeInput: { activityStart: {} }`.
   - Streaming audio: Send `realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: "<base64>" }] }`.
   - On `mic_stop`: Send `realtimeInput: { activityEnd: {} }`.
   - Never send `clientContent.turnComplete` for manual activity signaling turns; `activityEnd` signals end of user speech.
5. **Non-Blocking UI & Server Utterance Queue**:
   - Counter mic button remains enabled post-release; operator can press again immediately while previous utterance is processing.
   - *Protocol constraint*: Gemini Live throws a fatal 1008 WebSocket error if `activityStart` is sent while a tool call response is pending.
   - *Server queue*: If user begins speaking while a tool call is in-flight, audio chunks are buffered server-side. Once the tool response (`toolResponse`) is returned to Gemini, the server immediately dispatches `activityStart` followed by the buffered audio.
   - Tool executions are serialized in an asynchronous server queue to guarantee strict sequential ordering of bill rows.
6. **Speech Recognition Isolation**:
   - Browser `webkitSpeechRecognition` is disabled by default to prevent audio device contention and capture degradation on Android Chrome.
   - Gated behind debug flag: enabled only if URL query parameter `?debugSpeech=true` or `NEXT_PUBLIC_DEBUG_SPEECH=true`.
7. **Status Bar & Idempotency**:
   - Model text thoughts (`ai_thought`) are hidden from operator UI status bars; preserved in server logs only.
   - `close_bill` is idempotent: calling it on an already-closed bill returns `status: 'ok'` with the existing subtotal without creating duplicate records or error states.
8. **Telemetry & Clipping Diagnostics**:
   - Per-turn logging captures: `press_to_release_ms`, `release_to_tool_call_ms`, `tool_call_to_db_commit_ms`, `total_ms`, along with `audio_ms_sent` and `preroll_ms`.

3.8 Data-model deltas required by this section
Change | Reason
--- | ---
`sessions`: unique `(session_date, customer_number)`; date computed in `Asia/Kolkata` | Token resets at local midnight, not 05:30 IST (UTC midnight)
Drop `sessions.date_token` (redundant with the unique pair) | One truth
Token generated atomically (`max+1` inside a transaction or a per-day counter) | Avoid duplicate tokens on concurrent writes
`sessions.subtotal`: derive via view or trigger, or drop | Tap edits and voice edits must not desync it
`session_items.spoken_quantity_label` (keep) | UI subtext "250g (1 paav)" or "100g = 1 packet"
`items.canonical_name unique`, `item_aliases.alias_text unique` (keep) | Requires upsert/conflict handling in alias auto-learn (§3.9)
`items.net_content numeric(10,3) null`, `items.net_content_unit text null check in ('g', 'ml')` | Pack-size conversion and integer multiple checking (Migration 02)
Check constraint `chk_items_net_content` on `items` | Ensures `net_content` and `net_content_unit` are set together
Resolver returns top-N (2–3) with similarity, not `LIMIT 1` | Ambiguity/margin check
3.9 Resolver and alias-learning rules `[proposed]`
Threshold ≥ 0.3 is a starting value only; tune in the spike against real Hinglish transcripts ("atta" vs "aata" scores poorly on trigrams). Return top 2–3; if `top1 − top2 < margin`, return `ambiguous`.
Use the `%` operator with `pg_trgm.similarity_threshold` if index use ever matters (irrelevant at ≤1000 aliases).
Alias auto-learn from quick-map: upsert on `alias_text`. If the alias already maps to a different item, show a confirm ("'x' currently maps to Sugar. Remap?") rather than overwrite. Keep `created_at` and support undo of the last learned alias.
3.10 Mid-bill price updates — RESOLVED `[decided]`
Snapshot at add-time. `update_catalog_price` writes `items.current_price` and a `price_history` row; existing `session_items.unit_price_used` values are immutable. New lines use the new rate. Corrections to an existing line go through `edit_last_line_item` (voice, last row) or tap (any row), including `change_price`.
This reverses `kirana-context.md` §4 ("apply immediately, including in-progress bills"). Context §4 and §10 must be updated to match (see Companion edits).
3.11 Open items
#	Item	Blocks
1	Confirm `open_session` / `start_new_bill` tools and unit-mismatch reject behavior	Step 10
2	Spoken vs. silent confirmation: resolved as silent + earcons; reconfirm at counter test	Step 15
3	Hosting target and access gate	Step 7
4	Gemini Live spike outcomes (§3.7)	Steps 7–10
Companion edits (apply alongside this file)
`kirana-context.md` §4: replace "Apply immediately, including to in-progress bills" with "Catalog price applies to lines added after the update; existing lines keep their add-time price (snapshot). Correct an earlier line via voice (last row) or tap." Remove the corresponding open question in §10.
`kirana-context.md` §2.3 / §5: sessions are identified by an auto daily token (Asia/Kolkata), not a customer phone/number entered by the operator.
`kirana-context.md` §7: update the tool list to §3.3 above.
`README.md`: the function-schema pointer should reference `kirana-hld.md` §3; add the HTTPS/WSS and access-gate notes once decided.

---

## 4. Mid-Bill Price Updates & Alias Auto-Learn Rules

- **Mid-bill Price Updates**: Follow **immutable snapshot at add-time**. Once written to `session_items`, `unit_price_used` and `line_total` are locked. Updating catalog price affects only future additions.
- **Alias Ingestion & Conflicts**:
  - Mapping an unmapped item auto-inserts into `item_aliases` and shows a 5-second **"Undo Mapping"** toast.
  - If the spoken alias is already mapped to another item, prompt for 1-tap confirmation before reassigning.
