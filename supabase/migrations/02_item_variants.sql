-- =============================================================================
-- Kirana Voice Billing — Additive Migration 02: Item Variant Groups
-- =============================================================================
-- Enables support for priced SKU variant groups (e.g. Usna Chawal -> Baskathi,
-- Baba, Minikit, Rashan, Jeerakathi; Namak -> Tata Namak, Khula/Loose Salt).
-- Distinguishes group-level aliases from specific SKU aliases and configures
-- a default SKU per variant group.
-- =============================================================================

-- 1. Variant Groups Table
create table if not exists variant_groups (
  id uuid primary key default gen_random_uuid(),
  group_name text not null unique,
  default_item_id uuid references items(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 2. Associate Items with Variant Groups
alter table items add column if not exists variant_group_id uuid references variant_groups(id) on delete set null;

create index if not exists items_variant_group_idx on items(variant_group_id);

-- 3. Group-Level Spoken Aliases (e.g. "usna chawal", "namak")
create table if not exists variant_group_aliases (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references variant_groups(id) on delete cascade,
  alias_text text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists variant_group_aliases_trgm_idx 
on variant_group_aliases using gin (alias_text gin_trgm_ops);

-- 4. Row Level Security (RLS)
alter table variant_groups enable row level security;
alter table variant_group_aliases enable row level security;

create policy "Allow anon read variant_groups" on variant_groups for select using (true);
create policy "Allow anon read variant_group_aliases" on variant_group_aliases for select using (true);

create policy "Allow service_role full variant_groups" on variant_groups for all using (auth.role() = 'service_role');
create policy "Allow service_role full variant_group_aliases" on variant_group_aliases for all using (auth.role() = 'service_role');

-- 5. Seed Variant Groups & SKUs
do $$
declare
  v_usna_group_id uuid;
  v_namak_group_id uuid;
  v_baba_id uuid;
  v_baskathi_id uuid;
  v_minikit_id uuid;
  v_rashan_id uuid;
  v_jeerakathi_id uuid;
  v_tata_salt_id uuid;
  v_loose_salt_id uuid;
begin
  -- ---------------------------------------------------------------------------
  -- Group 1: Usna Chawal
  -- ---------------------------------------------------------------------------
  insert into variant_groups (group_name)
  values ('Usna Chawal')
  on conflict (group_name) do update set group_name = excluded.group_name
  returning id into v_usna_group_id;

  -- Add/Update SKUs for Usna Chawal
  -- Default SKU: Baba / Mansuri (₹36/kg)
  insert into items (canonical_name, unit_type, current_price, category, variant_group_id)
  values ('Usna Chawal (Baba)', 'kg', 36.00, 'Rice', v_usna_group_id)
  on conflict (canonical_name) do update set variant_group_id = v_usna_group_id
  returning id into v_baba_id;

  -- Set as default item for group
  update variant_groups set default_item_id = v_baba_id where id = v_usna_group_id;

  -- Other variants in group
  insert into items (canonical_name, unit_type, current_price, category, variant_group_id)
  values ('Usna Chawal (Baskathi)', 'kg', 42.00, 'Rice', v_usna_group_id)
  on conflict (canonical_name) do update set variant_group_id = v_usna_group_id
  returning id into v_baskathi_id;

  insert into items (canonical_name, unit_type, current_price, category, variant_group_id)
  values ('Usna Chawal (Minikit)', 'kg', 38.00, 'Rice', v_usna_group_id)
  on conflict (canonical_name) do update set variant_group_id = v_usna_group_id
  returning id into v_minikit_id;

  insert into items (canonical_name, unit_type, current_price, category, variant_group_id)
  values ('Usna Chawal (Rashan)', 'kg', 28.00, 'Rice', v_usna_group_id)
  on conflict (canonical_name) do update set variant_group_id = v_usna_group_id
  returning id into v_rashan_id;

  insert into items (canonical_name, unit_type, current_price, category, variant_group_id)
  values ('Usna Chawal (Jeerakathi)', 'kg', 48.00, 'Rice', v_usna_group_id)
  on conflict (canonical_name) do update set variant_group_id = v_usna_group_id
  returning id into v_jeerakathi_id;

  -- Group aliases: spoken terms that identify the whole group
  insert into variant_group_aliases (group_id, alias_text)
  values 
    (v_usna_group_id, 'usna chawal'),
    (v_usna_group_id, 'mota chawal'),
    (v_usna_group_id, 'bhaat chawal'),
    (v_usna_group_id, 'usna')
  on conflict (alias_text) do nothing;

  -- Specific SKU aliases
  insert into item_aliases (item_id, alias_text)
  values
    (v_baskathi_id, 'baskathi'),
    (v_baskathi_id, 'baskati'),
    (v_baskathi_id, 'baskathi usna'),
    (v_baba_id, 'baba chawal'),
    (v_baba_id, 'baba usna'),
    (v_baba_id, 'mansuri chawal'),
    (v_minikit_id, 'minikit'),
    (v_minikit_id, 'minikit usna'),
    (v_rashan_id, 'rashan chawal'),
    (v_rashan_id, 'ration chawal'),
    (v_rashan_id, 'sarkari chawal'),
    (v_jeerakathi_id, 'jeerakathi'),
    (v_jeerakathi_id, 'jeera kathi')
  on conflict (alias_text) do nothing;

  -- ---------------------------------------------------------------------------
  -- Group 2: Namak (Salt)
  -- ---------------------------------------------------------------------------
  insert into variant_groups (group_name)
  values ('Namak')
  on conflict (group_name) do update set group_name = excluded.group_name
  returning id into v_namak_group_id;

  -- Default SKU: Tata Salt 1kg (₹28/packet)
  select id into v_tata_salt_id from items where canonical_name ilike '%Tata Salt%' limit 1;
  if v_tata_salt_id is not null then
    update items set variant_group_id = v_namak_group_id where id = v_tata_salt_id;
    update variant_groups set default_item_id = v_tata_salt_id where id = v_namak_group_id;
  end if;

  -- Alternative SKU: Loose Local Salt (Khula Namak) (₹15/kg)
  insert into items (canonical_name, unit_type, current_price, category, variant_group_id)
  values ('Khula Namak (Loose Salt)', 'kg', 15.00, 'Staples', v_namak_group_id)
  on conflict (canonical_name) do update set variant_group_id = v_namak_group_id
  returning id into v_loose_salt_id;

  -- Group aliases
  insert into variant_group_aliases (group_id, alias_text)
  values
    (v_namak_group_id, 'namak'),
    (v_namak_group_id, 'salt')
  on conflict (alias_text) do nothing;

  -- Specific SKU aliases
  insert into item_aliases (item_id, alias_text)
  values
    (v_loose_salt_id, 'khula namak'),
    (v_loose_salt_id, 'loose namak'),
    (v_loose_salt_id, 'local namak')
  on conflict (alias_text) do nothing;

end $$;
