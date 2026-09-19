# Kirana Voice Billing 🛒

A voice-driven, instant billing system for family-run kirana/grocery shops in Ranchi, built on the **Google Gemini Live Multimodal API** and **Supabase (PostgreSQL + Realtime)**.

The shopkeeper speaks an item and colloquial quantity in Hinglish (*"chini aadha kilo"*, *"2 packet maggi"*, *"sarson tel 1 litre"*) — a priced line item appears instantly on the counter tablet. No typing, manual catalog lookups, or mental math required.

---

## 🌟 Key Features

1. **Voice Item Entry**: Say *"chini aadha kilo"* → an instant, snapshot-priced row (item, quantity, unit rate, line total) appears on the running bill.
2. **Deterministic Colloquial Quantity Parser**: Translates regional Hinglish units (*"1 paav"*, *"dhai-sau gram"*, *"dedh kilo"*, *"sawa do kilo"*, *"ek darjan"*) into standardized numeric quantities and validates unit compatibility.
3. **Fuzzy Item Alias Matching**: Spoken variants (*"chini"*, *"cheeni"*, *"sugar"*) resolve to canonical catalog items via PostgreSQL `pg_trgm` similarity search.
4. **Live Voice Activity & Heard Transcript Console**: Real-time interim speech subtitles, live hardware VU volume meter, and decoded command breakdowns anchored at the bottom of the screen.
5. **Per-Transaction Price Override**: Quote a custom rate for one line item (*"chini 70 me lagao"*) without altering the canonical catalog price.
6. **Voice Price Updates**: Commands like *"chini ka rate 75 karo"* permanently update the catalog rate and log an immutable audit trail in `price_history`.
7. **Resumable Daily Sessions**: Bills are tracked by daily customer tokens (`Token #1`, `Token #2`) in `Asia/Kolkata` time and can be resumed at any time from the Recent Bills drawer.
8. **Dual Bill-Close**: Close a bill verbally (*"total batao"* / *"bill complete"*) or via the manual 1-tap button.
9. **Zero-Latency Synthetic Earcons**: Web Audio procedural sound cues (pleasant retail chime on add/close, warning tone on mismatch/ambiguity) for low visual dependency.

---

## 🧠 System Architecture

```
┌────────────────────────────────────────────────────────┐
│         Browser / Tablet Billing UI (Next.js 14)       │
│                                                        │
│  - Realtime Bill Table       - Spacebar / Hold-to-Talk │
│  - Live Audio VU Meter       - Voice Transcript Ticker │
│  - Ambiguity Resolution      - Tap-to-Edit & Drawer    │
└──────────────────────────┬─────────────────────────────┘
                           │ 16kHz Linear PCM Audio (wss://.../ws/live?pin=...)
                           ▼
┌────────────────────────────────────────────────────────┐
│     Custom Node.js Server Gateway (server.ts)          │
│                                                        │
│  - 4-Digit SHOP_PIN Gatekeeper                         │
│  - Server-to-Server WebSocket Bridge                   │
│  - Gemini Live Multimodal Client (v1alpha)             │
│  - Audio Worklet 100ms Chunk Buffering (3.2KB frames)  │
│  - Tool Call Dispatcher & Latency Logger               │
└──────────────┬───────────────────────────┬─────────────┘
               │ Tool Calls (Hinglish)     │ Database Writes
               ▼                           ▼
┌──────────────────────────────┐ ┌───────────────────────┐
│ Gemini Live Multimodal API   │ │ Supabase (PostgreSQL) │
│ - gemini-2.5-flash-native    │ │ - items & item_aliases│
│ - Audio Output Suppressed    │ │ - price_history audit │
│ - 6 Atomic Function Tools    │ │ - sessions & tokens   │
└──────────────────────────────┘ │ - session_items       │
                                 └───────────┬───────────┘
                                             │ Realtime Broadcast
                                             ▼
                                  Single Source of Truth
```

---

## 🔒 Security & Secrets Posture

* **Zero Client Secret Exposure**: `GEMINI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` reside strictly on the Node.js server and are never exposed to the client bundle.
* **Access Gating**: All WebSocket connections and API routes are gated by a configurable 4-digit `SHOP_PIN`.
* **Git Protection**: All `.env*` files, build caches, and sensitive logs are excluded in `.gitignore`.

---

## 🚀 Setup & Local Development

### 1. Prerequisites
* **Node.js** v20+
* **pnpm** v11+ (`npm install -g pnpm`)
* **Supabase** account ([supabase.com](https://supabase.com))
* **Google Gemini API Key** ([aistudio.google.com](https://aistudio.google.com))

### 2. Configure Environment Variables
Create `.env.local` in the project root:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Google Gemini API Key
GEMINI_API_KEY=AIzaSy...

# Access Control
SHOP_PIN=1234

# Server Configuration
PORT=3000
NODE_ENV=development
```

### 3. Initialize the Database
In your Supabase **SQL Editor**:
1. Run [`supabase/migrations/01_init.sql`](file:///C:/Luminary/Projects/kirana-voice-billing/supabase/migrations/01_init.sql) (creates tables, atomic daily token generator, and `pg_trgm` indexes).
2. Run [`supabase/seed.sql`](file:///C:/Luminary/Projects/kirana-voice-billing/supabase/seed.sql) (loads 25 canonical items and 98 authentic Hinglish aliases).

### 4. Install & Run
```bash
# Install dependencies
pnpm install

# Run custom server + Next.js App Router
pnpm dev
```

Open **[http://localhost:3000](http://localhost:3000)** on your computer, or **`http://<YOUR_LOCAL_IP>:3000`** on a tablet connected to the same Wi-Fi.

---

## 🧪 Test Suites

```bash
# Run all unit and tool tests (parsers, resolvers, tool dispatcher)
pnpm test:all

# Run the Gemini Live WebSocket Spike test
pnpm spike:gemini

# Run the end-to-end WebSocket + Gemini Live turn test
pnpm test:integration

# Build production bundle
pnpm build
```

---

## 🗣️ Common Voice Commands (Hinglish)

| Command | Action |
|---|---|
| *"chini aadha kilo"* | Adds 0.5 kg Sugar at current catalog rate |
| *"aata 2 kilo"* | Adds 2.0 kg Aashirvaad Atta |
| *"sarson tel 1 litre"* | Adds 1.0 L Mustard Oil |
| *"2 packet maggi"* | Adds 2 packets of Maggi |
| *"chini 70 me lagao 1 kilo"* | Adds 1 kg Sugar with negotiated price override |
| *"chini ka rate 75 karo"* | Permanently updates catalog rate and logs audit record |
| *"total batao"* / *"bill complete"* | Computes total and marks bill closed |
| *"naya bill"* | Atomically allocates next daily customer token |
| *"token 3 kholo"* | Reopens/resumes customer Token #3 |
