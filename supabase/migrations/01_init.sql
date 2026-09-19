-- =============================================================================
-- Kirana Voice Billing — Supabase Schema Migration (01_init.sql)
-- =============================================================================

-- Enable pg_trgm for fuzzy string matching
create extension if not exists pg_trgm;

-- -----------------------------------------------------------------------------
-- 1. Canonical Items Catalog
-- -----------------------------------------------------------------------------
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  unit_type text not null check (unit_type in ('kg', 'g', 'litre', 'piece', 'packet')),
  current_price numeric(10,2) not null check (current_price >= 0),
  category text,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 2. Spoken Aliases (Hinglish variations)
-- -----------------------------------------------------------------------------
create table if not exists item_aliases (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  alias_text text not null unique,
  created_at timestamptz not null default now()
);

-- Trigram index for fast fuzzy matching
create index if not exists item_aliases_trgm_idx 
on item_aliases using gin (alias_text gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- 3. Price History Audit Trail
-- -----------------------------------------------------------------------------
create table if not exists price_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  old_price numeric(10,2) not null,
  new_price numeric(10,2) not null,
  changed_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 4. Customer Sessions (Daily Sequential Tokens reset at IST Midnight)
-- -----------------------------------------------------------------------------
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  session_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  customer_number int not null,
  status text not null default 'open' check (status in ('open', 'closed', 'resumed')),
  subtotal numeric(10,2) not null default 0.00,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint uq_session_date_token unique (session_date, customer_number)
);

-- Atomic daily token generator in Asia/Kolkata timezone
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

-- -----------------------------------------------------------------------------
-- 5. Bill Line Items (Snapshot Pricing at Add-Time)
-- -----------------------------------------------------------------------------
create table if not exists session_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  item_id uuid not null references items(id),
  quantity numeric(10,3) not null,
  unit text not null,
  spoken_quantity_label text, -- e.g. '1 paav', 'dhai-sau gram'
  unit_price_used numeric(10,2) not null, -- locked at add-time
  is_price_override boolean not null default false,
  line_total numeric(10,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists session_items_session_idx on session_items (session_id);

-- -----------------------------------------------------------------------------
-- 6. Subtotal Consistency Trigger
-- -----------------------------------------------------------------------------
create or replace function sync_session_subtotal()
returns trigger language plpgsql as $$
declare
  v_session_id uuid;
begin
  v_session_id := coalesce(new.session_id, old.session_id);
  update sessions
  set subtotal = coalesce((
    select sum(line_total) 
    from session_items 
    where session_id = v_session_id
  ), 0.00)
  where id = v_session_id;
  return null;
end;
$$;

drop trigger if exists trg_session_items_subtotal on session_items;
create trigger trg_session_items_subtotal
after insert or update or delete on session_items
for each row execute function sync_session_subtotal();

-- -----------------------------------------------------------------------------
-- 7. Tiered Fuzzy Item Resolver (Exact -> Trigram with Score & Margin)
-- -----------------------------------------------------------------------------
create or replace function resolve_item_by_alias(
  query_text text, 
  similarity_threshold float default 0.45
)
returns table (
  item_id uuid,
  canonical_name text,
  unit_type text,
  current_price numeric,
  matched_alias text,
  similarity float,
  is_exact boolean
) language sql stable as $$
  with exact_match as (
    select 
      i.id as item_id,
      i.canonical_name,
      i.unit_type,
      i.current_price,
      a.alias_text as matched_alias,
      1.0::float as similarity,
      true as is_exact
    from item_aliases a
    join items i on a.item_id = i.id
    where lower(trim(a.alias_text)) = lower(trim(query_text))
    limit 1
  ),
  fuzzy_matches as (
    select 
      i.id as item_id,
      i.canonical_name,
      i.unit_type,
      i.current_price,
      a.alias_text as matched_alias,
      greatest(
        similarity(a.alias_text, query_text), 
        word_similarity(query_text, a.alias_text) * 0.75
      )::float as similarity,
      false as is_exact
    from item_aliases a
    join items i on a.item_id = i.id
    where greatest(similarity(a.alias_text, query_text), word_similarity(query_text, a.alias_text) * 0.75) >= similarity_threshold
      and not exists (select 1 from exact_match)
    order by similarity desc
    limit 3
  )
  select * from exact_match
  union all
  select * from fuzzy_matches;
$$;

-- -----------------------------------------------------------------------------
-- 8. Row Level Security (RLS) & Realtime Publication
-- -----------------------------------------------------------------------------
alter table items enable row level security;
alter table item_aliases enable row level security;
alter table price_history enable row level security;
alter table sessions enable row level security;
alter table session_items enable row level security;

-- Read policies for anon role (client reads & Realtime change streams)
create policy "Allow anon read items" on items for select using (true);
create policy "Allow anon read aliases" on item_aliases for select using (true);
create policy "Allow anon read price history" on price_history for select using (true);
create policy "Allow anon read sessions" on sessions for select using (true);
create policy "Allow anon read session items" on session_items for select using (true);

-- Writes are restricted to service_role (used by server backend after PIN verification)
create policy "Allow service_role full items" on items for all using (auth.role() = 'service_role');
create policy "Allow service_role full aliases" on item_aliases for all using (auth.role() = 'service_role');
create policy "Allow service_role full price history" on price_history for all using (auth.role() = 'service_role');
create policy "Allow service_role full sessions" on sessions for all using (auth.role() = 'service_role');
create policy "Allow service_role full session items" on session_items for all using (auth.role() = 'service_role');

-- Enable Supabase Realtime publication
alter publication supabase_realtime add table sessions, session_items;
