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
  created_at timestamptz default now()
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
    "description": "Append a priced line item to the active bill when the shopkeeper names one item and a quantity.",
    "parameters": {
      "type": "object",
      "properties": {
        "item_name": { "type": "string", "description": "Spoken item name, romanized (e.g. 'chini', 'taaza chai', 'sarson tel')." },
        "quantity_text": { "type": "string", "description": "Raw spoken quantity phrase, romanized, unmodified (e.g. 'aadha kilo', '1 paav', 'dhai sau gram', '2 packet')." },
        "price_override": { "type": "number", "description": "Optional negotiated unit price for this line only." }
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
        "new_price": { "type": "number" }
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
1. On an item + quantity, call add_line_item immediately. Never ask for confirmation.
2. Pass price_override only if a specific rate is quoted for this sale ("chini 70 rupaye me lagao").
3. Corrections to the last row ("chini nahi, aata", "quantity 1 kilo karo", "wo hata do") -> edit_last_line_item.
4. "total batao" / "bill complete" -> close_bill.
5. "chini ka rate 75 karo" (permanent rate change) -> update_catalog_price.
6. "token 12 kholo" -> open_session. "naya bill" -> start_new_bill.
7. Output item_name and quantity_text in Roman script (Hinglish), never Devanagari. Pass quantity_text exactly as spoken; do not convert or compute numbers.
8. One item per utterance. Never speak; the screen is the response.
```
3.5 Server-side pipeline per `add_line_item` `[decided]`
`quantity_text` → deterministic parser → `{ quantity, base_unit, spoken_label }`. The model's numeric interpretation is never trusted.
`item_name` → alias resolver (pg_trgm) → item candidates.
Unit compatibility check (`[proposed]` behavior): parsed unit family must match `items.unit_type` (weight vs. count vs. volume). Mismatch → reject with `unit_mismatch`; do not convert silently.
Price = `price_override` if present else `items.current_price`; snapshot into `session_items.unit_price_used`. `line_total` computed server-side with one defined rounding rule (round half up to 2 dp).
Insert row, update session subtotal (via view/trigger, see §3.8), return result to Gemini.
3.6 Tool-response contract `[proposed]`
Every handler returns a structured object to the model and emits an earcon cue to the browser:
`status`	Meaning	Earcon	UI
`ok`	Row added/edited/closed	chime	Row appears via Realtime
`not_found`	No alias above threshold	two-tone warning	Unrecognized banner + 1-tap Map to Item
`ambiguous`	Top-2 candidates within margin	two-tone warning	Candidate chips to pick from
`unit_mismatch`	Spoken unit incompatible with item	two-tone warning	Inline flag on the utterance
`no_active_session` / `error`	Server-side failure	two-tone warning	Toast + retry
Payload example: `{ "status": "ok", "line_total": 22.0 }` or `{ "status": "ambiguous", "candidates": [{ "item_id": "…", "name": "…" }] }`.
3.7 Audio and activity handling `[verify]`
Hold-to-talk needs manual activity signaling: disable automatic VAD in the Live session config and send explicit activity start/end on press/release. Confirm exact config names against current Gemini Live docs.
Silent responses: "no TTS" depends on which response modalities the chosen model supports. If audio-out only, discard model audio server-side and never forward it to the browser.
Tool responses must be sent back to the session, or the turn stalls. Confirm behavior when a tool call returns `not_found`.
Script: the model may emit Devanagari despite instruction. Mitigation order: (a) prompt rule 7, (b) server-side transliteration or dual-script aliases, (c) store both scripts in `item_aliases`.
Latency: log per-utterance timestamps from day one (release → tool_call → DB commit → Realtime paint). The <400 ms figure is a target for the server-side leg only; end-to-end will be dominated by the Live round trip.
3.8 Data-model deltas required by this section
Change	Reason
`sessions`: unique `(session_date, customer_number)`; date computed in `Asia/Kolkata`	Token resets at local midnight, not 05:30 IST (UTC midnight)
Drop `sessions.date_token` (redundant with the unique pair)	One truth
Token generated atomically (`max+1` inside a transaction or a per-day counter)	Avoid duplicate tokens on concurrent writes
`sessions.subtotal`: derive via view or trigger, or drop	Tap edits and voice edits must not desync it
`session_items.spoken_quantity_label` (keep)	UI subtext "250g (1 paav)"
`items.canonical_name unique`, `item_aliases.alias_text unique` (keep)	Requires upsert/conflict handling in alias auto-learn (§3.9)
Resolver returns top-N (2–3) with similarity, not `LIMIT 1`	Ambiguity/margin check
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
