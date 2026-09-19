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

\- Trigger: explicit \*\*start/stop billing\*\* command (voice phrase or button) opens/closes

&#x20; a listening session — not always-listening. Push-to-talk-less mode is an explicit

&#x20; \*\*Phase 2\*\* enhancement, not initial scope.

\- On recognizing an utterance like "chini aadha kilo": resolve item alias → canonical

&#x20; item → unit price → compute line total → \*\*append as a new row instantly\*\*, no

&#x20; confirmation step. Optimize for speed; tolerate occasional ASR misses since

&#x20; correction is fast (see below).

\- \*\*One item per utterance\*\* for v1. Multi-item utterances ("aadha kilo chini aur do

&#x20; packet Taaza") are explicitly deferred.

\- Pricing: default to the catalog's fixed per-unit rate. Support a \*\*per-transaction

&#x20; override\*\* — the shopkeeper can quote a custom negotiated rate that applies only to

&#x20; that line item in that bill, without touching the catalog price.



\### 2.2 Corrections

\- \*\*Last row only, by voice\*\*: a verbal correction command ("chini nahi, aata" /

&#x20; "quantity galat hai, 1 kilo karo") edits the most recently added row.

\- \*\*Any row, by tap\*\*: editing an earlier row is done by tapping it on screen — no

&#x20; voice command needs to reach back further than the last row.



\### 2.3 Sessions

\- Each customer = one session, identified by a \*\*customer/session number\*\*.

\- Sessions are \*\*resumable\*\*: a bill marked "done" can be reopened if the same

&#x20; customer asks for more items shortly after. Don't treat bill-closed as

&#x20; session-deleted — keep it addressable until a new session explicitly starts.



\### 2.4 Closing a bill

\- Support \*\*both\*\*: a spoken command ("total batao" / "bill complete") and a manual

&#x20; button tap. Either should compute and display the final total.



\## 3. Item Catalog \& Language



\### 3.1 Catalog scale

\- \*\*200–1000 SKUs\*\*. Design fuzzy/alias matching to scale comfortably in this range

&#x20; (e.g. Postgres `pg\_trgm` similarity search, not a giant if/else chain).



\### 3.2 Unit types

\- Two item classes, each stored with \*\*its own unit type and price basis\*\*:

&#x20; - \*\*Loose/weight-based\*\* (sugar, atta, dal, etc.) — priced per kg, sold in

&#x20;   fractional/variable weights.

&#x20; - \*\*Fixed-count packaged\*\* (tea packets, biscuits, soap, etc.) — priced per

&#x20;   piece/packet, sold in whole units.

\- Catalog schema must not assume a single unit type across all items.



\### 3.3 Aliases \& language

\- Spoken language is \*\*Hinglish\*\* (mixed Hindi/English), not pure Hindi or pure

&#x20; English. Design the parsing grammar around this from the start, not as a

&#x20; translation layer bolted on later.

\- \*\*No pre-built alias list\*\* — aliases ("chini"/"cheeni"/"sugar" → Sugar; "taaza" →

&#x20; a specific tea brand) are added \*\*iteratively as ASR misses come up\*\* in real use.

&#x20; The system should make it trivially easy to add a new alias to an existing item

&#x20; (ideally from the correction flow itself — "that was actually X" should be able to

&#x20; feed the alias table).

\- \*\*Colloquial quantity units\*\* are in active use and must be parsed, not just

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

\- \*\*Apply immediately, including to in-progress bills\*\* — if a bill has a sugar line

&#x20; item already added and the price changes mid-session, the update should be

&#x20; reflected (not just for future line items). Confirm exact expected UX for this with

&#x20; Manish before building — e.g., does it recompute an already-added line's total, or

&#x20; only affect items added after the update?

\- \*\*Retain price-change history\*\* (item, old price, new price, timestamp) — an audit

&#x20; trail for margin tracking, not just an overwrite.

\- \*\*No batch update pattern\*\* needed (e.g. "bump all dal ₹5") — explicitly out of

&#x20; scope.



\## 5. Data Model (Postgres/Supabase)



items

id, canonical\_name, unit\_type ('kg' | 'piece' | 'litre' | ...),

current\_price, category (optional), created\_at



item\_aliases

item\_id (fk), alias\_text, created\_at

\-- supports "chini"/"cheeni"/"sugar" → same item\_id

\-- grows iteratively as ASR misses are corrected



price\_history

item\_id (fk), old\_price, new\_price, changed\_at



sessions (customer bills)

id, customer\_number, status ('open' | 'closed' | 'resumed'),

created\_at, closed\_at



session\_items (bill line items)

session\_id (fk), item\_id (fk), quantity, unit,

unit\_price\_used (catalog price OR negotiated override),

is\_price\_override (bool), line\_total, created\_at



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


\- \*\*Function-calling tools\*\* (server-to-server pattern, backend proxies the Live

&#x20; WebSocket — keep API keys server-side, consistent with prior project security

&#x20; posture):

&#x20; - `resolve\_item(spoken\_text) → {item\_id, canonical\_name, unit\_type, current\_price}`

&#x20;   — fuzzy-matches against `item\_aliases` (pg\_trgm), falls back to "not found" so the

&#x20;   UI can prompt for a new alias mapping.

&#x20; - `add\_line\_item(session\_id, item\_id, quantity, unit, price\_override?) → line\_total`

&#x20; - `edit\_last\_line\_item(session\_id, corrections)` — voice-driven correction of the

&#x20;   most recent row only.

&#x20; - `update\_price(spoken\_text, new\_price) → {item\_id, old\_price, new\_price}` — writes

&#x20;   to `items.current\_price` and appends a `price\_history` row.

&#x20; - `close\_bill(session\_id) → total`

\- \*\*Response modality\*\*: likely no spoken reply needed back to the shopkeeper — the

&#x20; screen update \*is\* the confirmation. Confirm before committing to silent/UI-only

&#x20; mode vs. a short spoken acknowledgment per item.

\- \*\*Quantity/unit parsing\*\*: don't rely purely on the model's free-form

&#x20; interpretation for colloquial units (paav, dhai-sau gram) — pair the Live session

&#x20; with a small deterministic parser/lookup table for known colloquial-to-standard

&#x20; unit conversions, feeding the model's transcription into it rather than trusting

&#x20; raw model output for numeric quantities.



\## 8. Platform Sequencing



\- \*\*Phase 1 — Web app\*\*: fast prototyping step, not the long-term target. Build for

&#x20; functional validation across devices (tablet + phone browser) rather than

&#x20; investing heavily in PWA/offline polish.

\- \*\*Phase 2 — Android app\*\*: the real intended target platform, reusing the same

&#x20; Supabase backend and Gemini Live integration built in Phase 1.



\## 9. Explicitly Out of Scope (v1)

\- Multi-item-per-utterance parsing

\- Always-listening / push-to-talk-less mode

\- Login/access control (single operator, no auth)

\- Khata/credit customer tracking

\- GST/tax breakdown

\- Automated discounts or rounding

\- Batch price updates
- Multi-item-per-utterance parsing

- Always-listening / push-to-talk-less mode

- Login/access control (single operator, no auth)

- Khata/credit customer tracking

- GST/tax breakdown

- Automated discounts or rounding

- Batch price updates

- Offline-first / conflict resolution



\## 10. Resolved Architectural Decisions (Pre-Build Alignment)

- **Mid-bill Price Update Semantics:** Snapshot at add-time. When a catalog price is updated mid-bill, previous lines remain locked at their historical rate (matching paper billing). Future lines use the new rate. Verbal and tap corrections remain available for individual row edits.
- **Alias Correction & Auto-Learn UX:** Inline 1-tap quick-map. Tapping an unmapped or misrecognized row opens an autocomplete picker to select the canonical SKU. Confirming updates the bill line and auto-learns the alias with a 5-second "Undo Mapping" toast. If the alias already exists on another item, a confirmation prompt prevents accidental overwrites.
- **Feedback Modality:** Subtle Web Audio API earcon chimes (high-pitch ding on success, gentle error tone on miss) + instant DOM visual update. Gemini TTS is suppressed to prevent acoustic mic feedback and counter speech clutter.
- **Mic Control:** Hold-to-Talk (press-and-hold on-screen button or Spacebar). Audio streams strictly while held, eliminating background shop noise and haggling.
- **Access Gate & Deployment:** Cloud Run deployment with native HTTPS/WSS for tablet microphone `getUserMedia` permissions. Gated by a 4-digit `SHOP_PIN` stored in tablet `localStorage`.
- **State Synchronization:** Supabase Realtime is the single authoritative source of truth for bill updates across devices. Server WebSocket is strictly an audio and session control pipe.
