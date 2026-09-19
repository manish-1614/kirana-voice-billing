import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { parseSpokenQuantity, CatalogUnitType } from '@/lib/quantity-parser';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ items: [] });
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

  return NextResponse.json({ items: items || [] });
}

export async function PATCH(req: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not connected' }, { status: 503 });
  }

  try {
    const body = await req.json();
    const { id, quantityText, priceOverride } = body;

    if (!id) {
      return NextResponse.json({ error: 'Item ID required' }, { status: 400 });
    }

    // Fetch existing item
    const { data: current, error: fetchErr } = await supabase
      .from('session_items')
      .select('*, items(canonical_name, unit_type)')
      .eq('id', id)
      .single();

    if (fetchErr || !current) {
      return NextResponse.json({ error: 'Line item not found' }, { status: 404 });
    }

    let updatedQuantity = current.quantity;
    let updatedUnit = current.unit;
    let updatedLabel = current.spoken_quantity_label;
    let updatedPrice = current.unit_price_used;
    let isOverride = current.is_price_override;

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

    if (typeof priceOverride === 'number' && priceOverride > 0) {
      updatedPrice = priceOverride;
      isOverride = true;
    }

    const newLineTotal = Math.round(updatedQuantity * updatedPrice * 100) / 100;

    const { data: updated, error: updateErr } = await supabase
      .from('session_items')
      .update({
        quantity: updatedQuantity,
        unit: updatedUnit,
        spoken_quantity_label: updatedLabel,
        unit_price_used: updatedPrice,
        is_price_override: isOverride,
        line_total: newLineTotal,
      })
      .eq('id', id)
      .select('*, items(canonical_name, unit_type, current_price)')
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ item: updated });
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
