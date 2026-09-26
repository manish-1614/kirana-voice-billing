\# Kirana Voice Billing — Project Context \& Grounding Document

\*\*Purpose:\*\* Seed document for AI Studio / a dedicated Claude Project so any future

build session starts with full context. Family-run kirana/grocery shop, Ranchi,

Jharkhand. Single-operator tool, prototyped as web, targeted for Android.


\---



\## 1. Problem Statement

A family-run kirana shop currently bills customers manually: the shopkeeper hears

items called out verbally (rarely a written list), writes down item, quantity/weight,

and per-unit price, then sums by hand. This app replaces the writing step with voice:

the shopkeeper speaks an item + quantity, and a priced line item appears instantly on

screen — no typing, no manual lookup, no manual arithmetic.



\## 2. Core Interaction Model



\### 2.1 Item entry

- Trigger: **Hold-to-Talk** (on-screen button or Spacebar). The audio pipeline (mic + AudioContext + worklet) is acquired once on the first gesture and kept warm; audio chunk streaming is gated on press/release without tearing down the audio graph.
- Pre-roll ring buffer (~300ms) preserves the first syllable. On release, a 300ms tail is captured and the worklet is flushed with acknowledgment before signaling turn completion.
- Non-blocking: releasing the mic immediately allows the next utterance while the previous one is processing. The server buffers audio during pending tool turns to prevent Gemini 1008 protocol errors and serializes database commits.
- On recognizing an utterance like "chini aadha kilo": resolve item alias → canonical item → unit price → compute line total → **append as a new row instantly**, no confirmation step.
- Pack-size conversion: when spoken quantity is weight/volume on a packaged SKU with `net_content` (e.g. "haldi 100 gram" on a 100g packet), deterministic conversion computes `n = spoken / net_content`. Integer multiples within ±1% convert to `n` packets. Non-multiples return `unit_mismatch`.
- **One item per utterance** for v1. Multi-item utterances ("aadha kilo chini aur do packet Taaza") are explicitly deferred.
- Pricing: default to the catalog's fixed per-unit rate. Support a **per-transaction override** — the shopkeeper can quote a custom negotiated rate that applies only to that line item in that bill, without touching the catalog price. Snapshot pricing at add-time.

\### 2.2 Corrections

\- \*\*Last row only, by voice\*\*: a verbal correction command ("chini nahi, aata" /

&#x20; "quantity galat hai, 1 kilo karo") edits the most recently added row.

\- \*\*Any row, by tap\*\*: editing an earlier row is done by tapping it on screen — no

&#x20; voice command needs to reach back further than the last row.

\### 2.3 Sessions

- Each customer = one session, identified by an **atomic daily sequential token** (Asia/Kolkata timezone, resetting at local midnight), not a manually typed customer phone/number.
- Sessions are **resumable**: a bill marked "closed" can be reopened if the same customer asks for more items shortly after. Don't treat bill-closed as session-deleted — keep it addressable until a new session explicitly starts.

\### 2.4 Closing a bill

- Support **both**: a spoken command ("total batao" / "bill complete") and a manual button tap. Either computes and displays the final total. `close_bill` is idempotent on already-closed sessions.



\## 3. Item Catalog \& Language



\### 3.1 Catalog scale

\- \*\*200–1000 SKUs\*\*. Design fuzzy/alias matching to scale comfortably in this range

&#x20; (e.g. Postgres `pg\_trgm` similarity search, not a giant if/else chain).



\### 3.2 Unit types

\- Two item classes, each stored with **its own unit type and price basis**:
  - **Loose/weight-based** (sugar, atta, dal, etc.) — priced per kg, sold in fractional/variable weights.
  - **Fixed-count packaged** (tea packets, biscuits, soap, etc.) — priced per piece/packet, sold in whole units.
- **Pack Sizes (`net_content`, `net_content_unit`)**: Packaged items store their net weight/volume content (e.g. 100g, 500g, 1000g, 250ml) to enable deterministic weight-to-packet conversions without model guesswork.

### 3.3 Aliases & language

- Spoken language is **Hinglish** (mixed Hindi/English), not pure Hindi or pure English.
- **Iterative Alias Learning & Unrecognized Item Flow**:
  - On unrecognized items (`not_found`), the server preserves the pending utterance in session context memory.
  - The UI presents an inline 3-action card within `AmbiguityBanner`:
    1. **Same as existing item**: Top-3 fuzzy suggestions + search box. On selection, maps alias → item, prompts confirmation on conflict, shows a 5-second undo toast, and auto-replays the line.
    2. **Add as new item**: Prefilled form with spoken name and suggested unit; requires current price and pack size if packaged; creates item + alias and auto-replays the line.
    3. **Ignore**: Discards the pending utterance.
- **Colloquial quantity units** are in active use and parsed deterministically:

&#x20; standard kg/g/piece:

&#x20; - "1 paav" (¼ kg / 250g colloquial unit)

&#x20; - "dhai-sau gram" (250g spoken as "two-and-a-half hundred grams")

&#x20; - Standard forms ("aadha kilo," "1 kilo," "do packet") also apply.

&#x20; - The quantity parser needs a small grammar/lookup for these colloquial terms

&#x20;   rather than relying on the model to freehand-interpret every phrasing.



\## 4. Price Management



\- \*\*Single operator, no access control needed\*\* — no login/auth layer at all for v1;

&#x20; the app is used directly.

\- Price updates via voice ("chini ka rate update karo, ab se 75 rupya kilo hai")

&#x20; resolve the item alias and \*\*write directly to the catalog's current price\*\*.

- **Snapshot at add-time**: Catalog price applies to lines added after the update; existing lines keep their add-time price (snapshot). Correct an earlier line via voice (last row) or tap.

\- \*\*Retain price-change history\*\* (item, old price, new price, timestamp) — an audit

&#x20; trail for margin tracking, not just an overwrite.

\- \*\*No batch update pattern\*\* needed (e.g. "bump all dal ₹5") — explicitly out of

&#x20; scope.



\## 5. Data Model (Postgres/Supabase)



items
id, canonical_name, unit_type ('kg' | 'piece' | 'litre' | ...),
current_price, category (optional),
net_content numeric(10,3) null, net_content_unit ('g' | 'ml') null,
created_at

item_aliases
item_id (fk), alias_text, created_at
-- supports "chini"/"cheeni"/"sugar" → same item_id
-- grows iteratively as ASR misses are corrected / learned

price_history
item_id (fk), old_price, new_price, changed_at

sessions (customer bills)
id, session_date (date in Asia/Kolkata), customer_number (atomic daily token),
status ('open' | 'closed' | 'resumed'), subtotal, created_at, closed_at

session_items (bill line items)
session_id (fk), item_id (fk), quantity, unit,
spoken_quantity_label (text, e.g. "1 paav", "100g = 1 packet"),
unit_price_used (catalog price OR negotiated override, immutable snapshot),
is_price_override (bool), line_total, created_at



\- Bill/session data retained for \*\*the last 2 days\*\* during this initial phase (a

&#x20; rolling window, not permanent archival yet — revisit once reporting needs are

&#x20; clearer).

\- \*\*Khata/credit customers are out of scope.\*\* Those accounts are already tracked in

&#x20; a physical khata-book and should not be modeled in this system for v1.

\- \*\*No GST/tax breakdown.\*\* Informal pricing only.

\- \*\*Discounts are manual only\*\* — no automated discount/rounding logic in v1.



\## 6. Backend \& Infra



\- \*\*Database: Supabase\*\* (Postgres + Auth + Realtime bundled) — chosen over

&#x20; NeonDB+Firebase-stitching because:

&#x20; - Postgres gives natural relational modeling for orders/line-items/price-history

&#x20;   joins.

&#x20; - `pg\_trgm` gives built-in fuzzy/alias matching for the spoken-name-to-item problem

&#x20;   (Section 3.3) without a separate vector store.

&#x20; - Realtime subscriptions support the multi-device sync requirement (Section 6

&#x20;   below) without extra plumbing.

&#x20; - Even though no login is needed for v1, Supabase Auth is available for free if a

&#x20;   later phase needs it (e.g. if staff logins are ever introduced).

\- \*\*Multi-device sync required\*\*: a tablet at the shop counter and Manish's Android

&#x20; phone both need to see live session/bill state. Use Supabase Realtime (Postgres

&#x20; change streams) rather than polling.

\- \*\*Connectivity\*\*: Wi-Fi and mobile data are both reliably available at the counter.

&#x20; \*\*Offline tolerance is not a hard requirement\*\* for v1 — don't over-invest in

&#x20; offline-queue/sync-conflict handling before it's actually needed.

\- Google Pro subscription with billing already enabled — Gemini Live API usage isn't

&#x20; blocked by billing setup.



\## 7. Gemini Live Integration

\## Repository
\- \*\*Public repo:\*\* https://github.com/manish-1614/kirana-voice-billing.git


- **Function-calling tools** (server-to-server pattern, backend proxies the Live WebSocket — session binding is managed server-side):
  - `add_line_item(item_name, quantity_text, price_override?)` — resolves item via tiered matching, runs deterministic quantity & pack-size parser, snapshots price, inserts row into `session_items`.
  - `edit_last_line_item(correction_type, new_value?)` — voice-driven correction or deletion of the most recent row on the active bill.
  - `update_catalog_price(item_name, new_price)` — writes to `items.current_price` and logs audit row to `price_history`.
  - `close_bill()` — idempotent bill closure; computes final total, marks session closed.
  - `open_session(token_number)` — switches to / reopens a customer session by today's sequential token.
  - `start_new_bill()` — starts the next customer token atomically.
- **Response modality**: Silent DOM update + Web Audio earcons ('chime' on success, 'warning' on mismatch/miss). Gemini TTS audio is suppressed server-side.
- **Turn Signaling & Audio**: Manual activity signaling (`realtimeInput.activityStart` / `realtimeInput.activityEnd` with `automaticActivityDetection.disabled = true`). Single warm audio stream with ~300ms pre-roll ring buffer and 300ms release tail. Server queues overlapping utterances during tool calls to prevent Gemini 1008 protocol errors.

## 8. Platform Sequencing

- **Phase 1 — Web app**: fast prototyping step, not the long-term target. Build for functional validation across devices (tablet + phone browser) rather than investing heavily in PWA/offline polish.
- **Phase 2 — Android app**: the real intended target platform, reusing the same Supabase backend and Gemini Live integration built in Phase 1.

## 9. Explicitly Out of Scope (v1)

- Multi-item-per-utterance parsing
- Always-listening / push-to-talk-less mode
- Login/access control (single operator, gated by 4-digit SHOP_PIN)
- Khata/credit customer tracking
- GST/tax breakdown
- Automated discounts or rounding
- Batch price updates
- Offline-first / conflict resolution

## 10. Resolved Architectural Decisions (Pre-Build Alignment)

- **Mid-bill Price Update Semantics:** Snapshot at add-time. When a catalog price is updated mid-bill, previous lines remain locked at their historical rate (matching paper billing). Future lines use the new rate. Verbal and tap corrections remain available for individual row edits.
- **Alias Correction & Auto-Learn UX:** Inline 1-tap quick-map card in `AmbiguityBanner`. Tapping an unmapped or misrecognized row opens options to map to an existing SKU or add a new item, with conflict confirmation and a 5-second "Undo Mapping" toast.
- **Feedback Modality:** Subtle Web Audio API earcon chimes (high-pitch ding on success, gentle error tone on miss) + instant DOM visual update. Gemini TTS is suppressed to prevent acoustic mic feedback.
- **Mic Control:** Hold-to-Talk with warm audio pipeline. Microphone and AudioWorklet are acquired once on first gesture and remain active. Audio streaming is gated on press/release with a 300ms pre-roll ring buffer and 300ms release tail. UI is non-blocking after release.
- **Gemini Live Signaling:** Manual activity signaling (`automaticActivityDetection.disabled = true`, `activityStart`, `activityEnd`). Server buffers overlapping utterances during pending tool calls to avoid protocol errors.
- **Access Gate & Deployment:** Cloud Run deployment with native HTTPS/WSS for tablet microphone `getUserMedia` permissions. Gated by a 4-digit `SHOP_PIN` stored in tablet `localStorage`.
- **State Synchronization:** Supabase Realtime is the single authoritative source of truth for bill updates across devices. Server WebSocket is strictly an audio and session control pipe.
