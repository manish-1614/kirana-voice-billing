import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { parseSpokenQuantity, CatalogUnitType } from '@/lib/quantity-parser';
import { parsePricePhrase } from '@/lib/price-parser';
import { attachVariantInfo } from '@/lib/item-resolver';
import { SEED_CATALOG } from '@/lib/catalog-data';
import { IN_MEMORY_SESSION_ITEMS } from '@/lib/tool-dispatcher';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    const memoryItems = IN_MEMORY_SESSION_ITEMS.get(sessionId) || [];
    const formatted = memoryItems.map((row: any) => {
      const variantData = attachVariantInfo({
        id: row.items?.id || row.item_id,
        canonical_name: row.items?.canonical_name || 'Unknown Item',
        unit_type: row.items?.unit_type || row.unit,
        current_price: row.items?.current_price || row.unit_price_used,
        matched_alias: '',
        similarity: 1.0,
        is_exact: true,
      });
      return {
        id: row.id,
        canonical_name: row.items?.canonical_name || 'Unknown Item',
        quantity: row.quantity,
        unit: row.unit,
        spoken_quantity_label: row.spoken_quantity_label,
        unit_price: row.unit_price_used,
        line_total: row.line_total,
        is_price_override: row.is_price_override,
        variant_group_id: variantData.variant_group_id,
        variant_group_name: variantData.variant_group_name,
        available_variants: variantData.available_variants,
      };
    });
    return NextResponse.json({ items: formatted });
  }

  const { data: items, error } = await supabase
    .from('session_items')
    .select(`
      id,
      session_id,
      item_id,
      quantity,
      unit,
      spoken_quantity_label,
      unit_price_used,
      is_price_override,
      line_total,
      created_at,
      items (
        id,
        canonical_name,
        unit_type,
        current_price
      )
    `)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Enrich items with variant group alternatives
  const enriched = (items || []).map((row: any) => {
    if (row.items) {
      const variantData = attachVariantInfo({
        id: row.items.id || row.item_id,
        canonical_name: row.items.canonical_name,
        unit_type: row.items.unit_type,
        current_price: row.items.current_price,
        matched_alias: '',
        similarity: 1.0,
        is_exact: true,
      });
      return {
        ...row,
        items: {
          ...row.items,
          variant_group_id: variantData.variant_group_id,
          variant_group_name: variantData.variant_group_name,
          available_variants: variantData.available_variants,
        },
      };
    }
    return row;
  });

  return NextResponse.json({ items: enriched });
}

export async function PATCH(req: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not connected' }, { status: 503 });
  }

  try {
    const body = await req.json();
    const { id, quantityText, priceOverride, itemId } = body;

    if (!id) {
      return NextResponse.json({ error: 'Item ID required' }, { status: 400 });
    }

    // Fetch existing item
    const { data: current, error: fetchErr } = await supabase
      .from('session_items')
      .select('*, items(id, canonical_name, unit_type, current_price)')
      .eq('id', id)
      .single();

    if (fetchErr || !current) {
      return NextResponse.json({ error: 'Line item not found' }, { status: 404 });
    }

    let updatedItemId = current.item_id;
    let updatedQuantity = current.quantity;
    let updatedUnit = current.unit;
    let updatedLabel = current.spoken_quantity_label;
    let updatedPrice = current.unit_price_used;
    let isOverride = current.is_price_override;

    // Handle variant SKU switch if requested
    if (itemId && itemId !== current.item_id) {
      let newItem: any = null;
      const { data: dbItem } = await supabase
        .from('items')
        .select('*')
        .eq('id', itemId)
        .maybeSingle();

      newItem = dbItem;
      if (!newItem) {
        newItem = SEED_CATALOG.find((ci) => ci.id === itemId);
      }

      if (!newItem) {
        return NextResponse.json({ error: `Selected variant "${itemId}" not found` }, { status: 404 });
      }

      updatedItemId = newItem.id;
      updatedUnit = newItem.unit_type;

      // Re-evaluate quantity if quantityText is given or re-check compatibility
      if (quantityText) {
        const parseRes = parseSpokenQuantity(quantityText, newItem.unit_type as CatalogUnitType);
        if (!parseRes.valid) {
          return NextResponse.json({ error: parseRes.errorMessage || 'Invalid quantity' }, { status: 400 });
        }
        updatedQuantity = parseRes.normalizedQuantity;
        updatedLabel = parseRes.spokenLabel;
      }

      // Variant price rule:
      // If user supplied an explicit priceOverride in this update, apply it.
      // Otherwise reset to the new variant's catalog price and reset is_price_override to false.
      if (priceOverride !== undefined && priceOverride !== null && priceOverride !== '') {
        const priceParse = parsePricePhrase(priceOverride);
        if (priceParse.valid) {
          updatedPrice = priceParse.price!;
          isOverride = updatedPrice !== newItem.current_price;
        }
      } else {
        updatedPrice = newItem.current_price;
        isOverride = false;
      }
    } else {
      // Standard quantity update without changing item
      if (quantityText) {
        const unitType = (current.items?.unit_type || current.unit) as CatalogUnitType;
        const parseRes = parseSpokenQuantity(quantityText, unitType);
        if (!parseRes.valid) {
          return NextResponse.json({ error: parseRes.errorMessage || 'Invalid quantity' }, { status: 400 });
        }
        updatedQuantity = parseRes.normalizedQuantity;
        updatedUnit = parseRes.targetUnit;
        updatedLabel = parseRes.spokenLabel;
      }

      // Price override update
      if (priceOverride !== undefined && priceOverride !== null && priceOverride !== '') {
        const priceParse = parsePricePhrase(priceOverride);
        if (priceParse.valid) {
          updatedPrice = priceParse.price!;
          isOverride = updatedPrice !== (current.items?.current_price ?? updatedPrice);
        }
      }
    }

    const newLineTotal = Math.round(updatedQuantity * updatedPrice * 100) / 100;

    const { data: updated, error: updateErr } = await supabase
      .from('session_items')
      .update({
        item_id: updatedItemId,
        quantity: updatedQuantity,
        unit: updatedUnit,
        spoken_quantity_label: updatedLabel,
        unit_price_used: updatedPrice,
        is_price_override: isOverride,
        line_total: newLineTotal,
      })
      .eq('id', id)
      .select('*, items(id, canonical_name, unit_type, current_price)')
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // Enrich with variant information
    let enrichedItem = updated;
    if (updated?.items) {
      const variantData = attachVariantInfo({
        id: updated.items.id || updated.item_id,
        canonical_name: updated.items.canonical_name,
        unit_type: updated.items.unit_type,
        current_price: updated.items.current_price,
        matched_alias: '',
        similarity: 1.0,
        is_exact: true,
      });
      enrichedItem = {
        ...updated,
        items: {
          ...updated.items,
          variant_group_id: variantData.variant_group_id,
          variant_group_name: variantData.variant_group_name,
          available_variants: variantData.available_variants,
        },
      };
    }

    return NextResponse.json({ item: enrichedItem });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not connected' }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Item ID required' }, { status: 400 });
  }

  const { error } = await supabase
    .from('session_items')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, id });
}
