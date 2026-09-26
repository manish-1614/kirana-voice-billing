# Kirana Voice Billing — Build Plan (v2)

**Status legend:** ⬜ Not started · 🔶 In progress · ✅ Done · 🔑 Needs API keys · ⛔ Blocked on decision
**Supersedes:** v1 (10 steps). Reflects the agreed architecture resolutions and `kirana-hld.md` §3 (reconciled).

---

## Phase 0 — Doc Reconciliation (before code)

| Step | Task | Status |
|---|---|---|
| 0.1 | Replace HLD §3 and §4 with reconciled §3 (tools, session binding, snapshot pricing) | ✅ |
| 0.2 | Update `kirana-context.md` §2.3, §4, §5, §7, §10 per HLD companion edits | ✅ |
| 0.3 | Update HLD §2 schema to match §3.8 deltas (unique `(session_date, customer_number)`, drop `date_token`, `subtotal` strategy, `spoken_quantity_label`) | ✅ |
| 0.4 | README: point to HLD §3, add HTTPS/WSS + access-gate notes once decided | ✅ |

## Phase 1 — Web MVP (tablet-first, single device)

### 1A. Foundation (no keys required)

| Step | Task | Deliverable | Status |
|---|---|---|---|
| 1 | **Project Scaffolding** | Next.js App Router, TypeScript, TailwindCSS, `server.ts` skeleton, `Dockerfile` for Cloud Run | ✅ |
| 2 | **Database Migration** | `supabase/migrations/01_init.sql` (IST daily tokens, `pg_trgm`, subtotal trigger, tiered resolver) | ✅ |
| 3 | **Catalog Seed Data** | `supabase/seed.sql` (~25 curated Ranchi staples with authentic Hinglish aliases) | ✅ |
| 4 | **Deterministic Quantity Parser** | `lib/quantity-parser.ts` + unit test suite `lib/quantity-parser.test.ts` (N paav, sawa/sadhe/paune, Hindi numbers, liquids, unit mismatch check) | ✅ |
| 5 | **Environment & Access Gate** | `.env.example`, `SHOP_PIN` verification middleware and headers | ✅ |

### 1B. Risk retirement and decisions (needs keys / decisions)

| Step | Task | Status |
|---|---|---|
| 5 | **Gemini Live spike** (standalone script): manual activity signaling, Hinglish accuracy, Roman vs. Devanagari output, response-modality/silent mode, tool-response round trip, latency logging. Feeds threshold tuning for the resolver | ✅ |
| 6 | **Decide hosting + access gate**: Cloud Run (TLS/WSS) + 4-digit `SHOP_PIN` in localStorage + service-role server-side, anon SELECT-only RLS for browser Realtime | ✅ |

### 1C. Core voice loop

| Step | Task | Status |
|---|---|---|
| 7 | Custom server + WS bridge: PCM proxy to Gemini Live, per-connection active session, PIN check, per-utterance latency log | ✅ |
| 8 | Audio capture worklet (16 kHz PCM) + hold-to-talk button/Spacebar + earcons (chime / two-tone) | ✅ |
| 9 | Billing UI: live row table driven by **Supabase Realtime** (single source of truth), running total, status indicator, manual Close Bill / New Bill | ✅ |
| 10 | Tool handlers per HLD §3.3–3.6: `add_line_item`, `edit_last_line_item`, `update_catalog_price` (snapshot + `price_history`), `close_bill`, `open_session`, `start_new_bill`; structured status responses (`ok / not_found / ambiguous / unit_mismatch`) | ✅ |
| 11 | Tap-to-edit on any row; unrecognized/ambiguous banner with 1-tap quick-map; alias auto-learn with upsert-conflict confirm and undo | ✅ |

### 1D. Sessions, retention, validation

| Step | Task | Status |
|---|---|---|
| 12 | Daily token generator (Asia/Kolkata, atomic), Recent Bills drawer, resume by tap or voice | ✅ |
| 13 | 2-day rolling retention job (Supabase cron / edge function) for `sessions` / `session_items` | ⬜ |
| 14 | Price-history: log-only (table populated by handler); no UI | ⬜ |
| 15 | Manual test pass at the actual counter with real Hinglish phrasing; tune resolver threshold/margin; review latency logs | ⬜ |

### 1E. Voice Pipeline Robustness & Pack-Size Resolution (Issues 1 & 2)

| Step | Task | Deliverable | Status |
|---|---|---|---|
| 17 | **Issue 1: Hold-to-Talk Pipeline & Gemini Manual Activity** | Warm audio graph (`getUserMedia` + context + worklet initialized on first gesture); 300ms pre-roll ring buffer; release tail capture (`RELEASE_TAIL_MS = 300`) + worklet flush ack handshake before `mic_stop`; switch Gemini Live bridge to manual activity signaling (`automaticActivityDetection.disabled = true`, `activityStart`, `activityEnd`); non-blocking UI post-release with server audio queue buffering during pending tool calls (preventing 1008 WebSocket errors); browser `SpeechRecognition` off by default behind `?debugSpeech=true` / `NEXT_PUBLIC_DEBUG_SPEECH=true`; hide `ai_thought` from operator status bar; idempotent `close_bill`; latency + audio duration telemetry (`audio_ms_sent`, `preroll_ms`); unit tests for recorder gating/flush handshake & bridge activity signaling sequence. | ✅ |
| 18 | **Issue 2a: Unrecognized Item Flow & Alias Auto-Learning** | Migration `02_pack_sizes_and_aliases.sql` (schema additions); server stores pending utterance in session context memory on `not_found`; `AmbiguityBanner` inline 3-action card ("Same as existing item" with fuzzy suggestions/search, "Add as new item" with prefilled form & suggested unit, "Ignore"); WebSocket `resolve_pending_item` handler; alias upsert with conflict confirmation and 5-second undo toast; automatic replay of pending line into `session_items`; tests for conflict & replay. | ⬜ |
| 19 | **Issue 2b: Pack-Size Conversion & Deterministic Matcher** | Migration `02_pack_sizes_and_aliases.sql` columns `net_content numeric(10,3) null`, `net_content_unit text null check in ('g', 'ml')` + check constraint; seed backfill for weighted items (Haldi 100g, Taaza 250g, Tata Salt 1kg, Vim Bar 125g, Surf Excel 500g, etc.); deterministic conversion in `add_line_item` (`n = spoken / net_content`, integer within ±1% tolerance converts to `n` packets, non-multiples return `unit_mismatch`); missing pack size prompt & replay; loose vs packaged SKU tie-breaking; round half up to 2 dp rounding rule; unit test suite for multiples, tolerance, ml, mismatch, and dispatcher statuses. | ⬜ |

### Optional / deferred within Phase 1

| Step | Task | Status |
|---|---|---|
| 16 | Second-device sync (phone). Schema and Realtime publication already in place; step is UI and RLS verification only | ⬜ (deferred) |

## Phase 2 — Android

| Step | Task | Status |
|---|---|---|
| 1 | Confirm what ports directly (Supabase client, tool contracts, parser) vs. native rework (mic capture, WS/audio handling) | ⬜ |
| 2 | Native/wrapped app shell | ⬜ |
| 3 | Re-test voice recognition quality on-device vs. browser | ⬜ |

---

## Dependency Notes

- Steps 1–4 have no external dependencies and can start immediately.
- Step 5 (spike) precedes 7–10; its results may change §3.7 and the system prompt.
- Step 6 gates Step 7 (WS transport must be `wss://` with relative host, and gated).
- Step 9 depends on Step 2 (schema) and the RLS choice from Step 6.

## What to Cut First If Time Runs Short

1. Step 16 (second-device sync) → tablet only.
2. Voice `open_session` → resume via Recent Bills tap only.
3. Price-history UI (already excluded) → flat table only.
4. Alias undo → manual correction in DB.
5. **Never cut:** voice item entry with auto-append, catalog price update with history, manual bill-close button, unit-mismatch and ambiguity flagging (silent wrong bills are worse than slow ones).

## Deferred (out of scope for v1)

- Multi-item-per-utterance parsing
- Always-listening mode (v1 is hold-to-talk)
- Khata/credit tracking
- GST/tax, automated discounts
- Offline-first handling
- Batch price updates
- Android build (Phase 2, not concurrent)

## Decisions Log

| Decision | Choice |
|---|---|
| Runtime | Single Next.js custom server + integrated `ws` |
| Gemini tool style | Single-turn atomic tools, no `resolve_item` round trip |
| Mid-bill price change | Snapshot at add-time (reverses earlier "apply to in-progress bills") |
| Feedback | Earcons + visual; no TTS |
| Mic | Hold-to-talk |
| Sessions | Auto daily token, Asia/Kolkata |
| Bill state source of truth | Supabase Realtime |
| Multi-device | Single tablet first |
