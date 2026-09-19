-- =============================================================================
-- Kirana Voice Billing — Seed Catalog (~25 Ranchi Grocery Essentials)
-- =============================================================================

do $$
declare
  item_id uuid;
begin
  -- 1. Sugar (Chini)
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Sugar (Chini)', 'kg', 44.00, 'Staples') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'chini'), (item_id, 'cheeni'), (item_id, 'sugar'), (item_id, 'sakkar'), (item_id, 'shakar');

  -- 2. Aashirvaad Atta
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Aashirvaad Atta', 'kg', 38.00, 'Staples') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'atta'), (item_id, 'aata'), (item_id, 'aashirvaad atta'), (item_id, 'gehu ka aata'), (item_id, 'chakki atta');

  -- 3. Mustard Oil (Sarson Tel)
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Mustard Oil (Kachhi Ghani)', 'litre', 145.00, 'Oils') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'sarson tel'), (item_id, 'mustard oil'), (item_id, 'sarso tel'), (item_id, 'kachhi ghani'), (item_id, 'kadwa tel');

  -- 4. Fortune Refined Oil
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Fortune Refined Oil', 'litre', 130.00, 'Oils') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'refined oil'), (item_id, 'fortune tel'), (item_id, 'refined'), (item_id, 'white tel');

  -- 5. Toor Dal (Arhar Dal)
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Toor Dal (Arhar)', 'kg', 160.00, 'Dals') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'toor dal'), (item_id, 'arhar dal'), (item_id, 'rahar dal'), (item_id, 'peeli dal'), (item_id, 'arhar');

  -- 6. Chana Dal
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Chana Dal', 'kg', 88.00, 'Dals') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'chana dal'), (item_id, 'chane ki dal'), (item_id, 'chana');

  -- 7. Moong Dal Dhuli
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Moong Dal Dhuli', 'kg', 120.00, 'Dals') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'moong dal'), (item_id, 'mung dal'), (item_id, 'dhuli moong'), (item_id, 'peeli moong');

  -- 8. Masoor Dal
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Masoor Dal', 'kg', 95.00, 'Dals') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'masoor dal'), (item_id, 'masur dal'), (item_id, 'lal dal');

  -- 9. Tata Tea Premium
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Tata Tea Premium', 'packet', 140.00, 'Beverages') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'tata tea'), (item_id, 'tata chai'), (item_id, 'chai patti'), (item_id, 'tata premium');

  -- 10. Taaza Tea 250g
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Taaza Tea 250g', 'packet', 70.00, 'Beverages') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'taaza'), (item_id, 'taaza chai'), (item_id, 'taza tea'), (item_id, 'taza chai');

  -- 11. Tata Salt
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Tata Salt 1kg', 'packet', 28.00, 'Staples') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'namak'), (item_id, 'tata salt'), (item_id, 'salt'), (item_id, 'tata namak'), (item_id, 'sada namak');

  -- 12. Maggi 2-Minute Noodles
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Maggi Noodles', 'packet', 14.00, 'Packaged Goods') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'maggi'), (item_id, 'maggie'), (item_id, 'noodles'), (item_id, '2 minute maggi');

  -- 13. Besan (Gram Flour)
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Besan', 'kg', 90.00, 'Staples') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'besan'), (item_id, 'chana besan');

  -- 14. Maida
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Maida', 'kg', 40.00, 'Staples') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'maida'), (item_id, 'refined flour');

  -- 15. Suji (Rawa)
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Suji (Rawa)', 'kg', 42.00, 'Staples') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'suji'), (item_id, 'sooji'), (item_id, 'rawa');

  -- 16. Basmati Rice Everyday
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Basmati Rice Everyday', 'kg', 75.00, 'Rice') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'basmati chawal'), (item_id, 'everyday rice'), (item_id, 'basmati'), (item_id, 'chawal');

  -- 17. Usna Chawal (Boiled Rice)
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Usna Chawal', 'kg', 36.00, 'Rice') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'usna chawal'), (item_id, 'mota chawal'), (item_id, 'bhaat chawal'), (item_id, 'usna');

  -- 18. Haldi Powder 100g
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Haldi Powder 100g', 'packet', 32.00, 'Spices') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'haldi'), (item_id, 'haldi powder'), (item_id, 'turmeric'), (item_id, 'pisa haldi');

  -- 19. Mirchi Powder 100g
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Mirchi Powder 100g', 'packet', 45.00, 'Spices') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'mircha powder'), (item_id, 'lal mirch'), (item_id, 'chilli powder'), (item_id, 'mirchi powder'), (item_id, 'mirchi');

  -- 20. Dhaniya Powder 100g
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Dhaniya Powder 100g', 'packet', 35.00, 'Spices') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'dhaniya powder'), (item_id, 'dhaniya'), (item_id, 'pisa dhaniya');

  -- 21. Jeera (Cumin Seeds)
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Jeera (Cumin Seeds)', 'kg', 380.00, 'Spices') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'jeera'), (item_id, 'jira'), (item_id, 'cumin'), (item_id, 'sabut jeera');

  -- 22. Dettol Soap
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Dettol Soap', 'piece', 38.00, 'Personal Care') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'dettol sabun'), (item_id, 'dettol soap'), (item_id, 'dettol'), (item_id, 'nahane ka sabun');

  -- 23. Vim Bar 125g
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Vim Bar 125g', 'piece', 15.00, 'Cleaning') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'vim bar'), (item_id, 'bartan sabun'), (item_id, 'vim sabun'), (item_id, 'vim');

  -- 24. Surf Excel Quick Wash 500g
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Surf Excel 500g', 'packet', 85.00, 'Cleaning') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'surf excel'), (item_id, 'surf'), (item_id, 'detergent powder'), (item_id, 'excel surf');

  -- 25. Parle-G Biscuit
  insert into items (canonical_name, unit_type, current_price, category)
  values ('Parle-G Biscuit', 'packet', 10.00, 'Snacks') returning id into item_id;
  insert into item_aliases (item_id, alias_text) values
    (item_id, 'parle g'), (item_id, 'parle ji'), (item_id, 'biscuit'), (item_id, 'parle biscuit');

end $$;
