/**
 * Kirana Voice Billing — Tool Dispatcher & Handlers
 * 
 * Implements the 6 core function tools defined in HLD §3.3:
 * 1. add_line_item: Resolves item, parses colloquial quantity, snapshots price, commits to session_items
 * 2. edit_last_line_item: Corrects or deletes the most recent line on the active bill
 * 3. update_catalog_price: Permanently updates item catalog rate and logs to price_history
 * 4. close_bill: Computes final total and marks active session closed
 * 5. open_session: Reopens / switches to a customer session by today's token number
 * 6. start_new_bill: Atomically generates next daily sequential token (Asia/Kolkata)
 * 
 * Enforces structured return contracts and maps the appropriate synthetic earcon cue
 * ('chime' for success, 'warning' for miss/ambiguous/mismatch) per HLD §3.6.
 */

import { getServerSupabase } from './supabase/server';
import { resolveItem, ResolveResult, ResolvedItem } from './item-resolver';
import { parseSpokenQuantity, CatalogUnitType } from './quantity-parser';
import { EarconType } from './audio/earcon';

export interface SessionContext {
  sessionId: string;
  customerNumber: number;
  sessionDate: string;
  status: 'open' | 'closed' | 'resumed';
}

export interface ToolExecutionResult {
  status: 'ok' | 'not_found' | 'ambiguous' | 'unit_mismatch' | 'no_active_session' | 'error';
  message?: string;
  earcon: EarconType;
  data?: any;
  contextUpdate?: Partial<SessionContext>;
}

/**
 * Tool definitions conforming to Gemini Live API schema (HLD §3.3)
 */
export const GEMINI_TOOL_DECLARATIONS = [
  {
    name: 'add_line_item',
    description: 'Append a priced line item to the active bill when the shopkeeper names one item and a quantity.',
    parameters: {
      type: 'OBJECT',
      properties: {
        item_name: {
          type: 'STRING',
          description: 'Spoken item name, romanized Hinglish (e.g. "chini", "aata", "sarson tel", "maggi"). Never Devanagari.',
        },
        quantity_text: {
          type: 'STRING',
          description: 'Raw spoken quantity phrase, romanized, unmodified (e.g. "aadha kilo", "1 paav", "dhai sau gram", "2 packet").',
        },
        price_override: {
          type: 'NUMBER',
          description: 'Optional negotiated unit price for this line item only (e.g. 70 for chini if customer negotiated).',
        },
      },
      required: ['item_name', 'quantity_text'],
    },
  },
  {
    name: 'edit_last_line_item',
    description: 'Correct or delete the most recently added line on the active bill.',
    parameters: {
      type: 'OBJECT',
      properties: {
        correction_type: {
          type: 'STRING',
          description: 'The type of correction to apply to the last item.',
          enum: ['change_item', 'change_quantity', 'change_price', 'delete_row'],
        },
        new_value: {
          type: 'STRING',
          description: 'Spoken new value, romanized (e.g. "aata" for change_item, "1 kilo" for change_quantity, "75" for change_price). Omit for delete_row.',
        },
      },
      required: ['correction_type'],
    },
  },
  {
    name: 'update_catalog_price',
    description: 'Permanently update an item\'s catalog price on an explicit rate-change command (e.g. "chini ka rate 75 karo").',
    parameters: {
      type: 'OBJECT',
      properties: {
        item_name: {
          type: 'STRING',
          description: 'Spoken item name in Roman Hinglish whose catalog price should change.',
        },
        new_price: {
          type: 'NUMBER',
          description: 'New numeric price per canonical unit.',
        },
      },
      required: ['item_name', 'new_price'],
    },
  },
  {
    name: 'close_bill',
    description: 'Compute the total and close the active session on "total batao" / "bill complete".',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'open_session',
    description: 'Reopen a session by today\'s token number, e.g. "token 12 kholo".',
    parameters: {
      type: 'OBJECT',
      properties: {
        token_number: {
          type: 'INTEGER',
          description: 'Today\'s customer token number to reopen.',
        },
      },
      required: ['token_number'],
    },
  },
  {
    name: 'start_new_bill',
    description: 'Start a new customer session on "naya bill" / "agli bill".',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
];

/**
 * Fetches the active open session or creates the first session of the day
 */
export async function getOrCreateActiveSession(requestedSessionId?: string): Promise<SessionContext> {
  const supabase = getServerSupabase();
  const todayIST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

  if (!supabase) {
    // In-memory fallback if running without Supabase credentials
    return {
      sessionId: requestedSessionId || 'mock-session-001',
      customerNumber: 1,
      sessionDate: todayIST,
      status: 'open',
    };
  }

  // 1. If explicit sessionId is requested, verify and return it
  if (requestedSessionId) {
    const { data: session } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', requestedSessionId)
      .single();

    if (session) {
      return {
        sessionId: session.id,
        customerNumber: session.customer_number,
        sessionDate: session.session_date,
        status: session.status,
      };
    }
  }

  // 2. Otherwise find the latest open or resumed session for today
  const { data: openSession } = await supabase
    .from('sessions')
    .select('*')
    .eq('session_date', todayIST)
    .in('status', ['open', 'resumed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (openSession) {
    return {
      sessionId: openSession.id,
      customerNumber: openSession.customer_number,
      sessionDate: openSession.session_date,
      status: openSession.status,
    };
  }

  // 3. If none open, create a new daily session atomically
  return createNewSession(supabase, todayIST);
}

/**
 * Creates a brand new daily sequential session
 */
export async function createNewSession(supabaseClient?: any, todayIST?: string): Promise<SessionContext> {
  const supabase = supabaseClient || getServerSupabase();
  const dateStr = todayIST || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

  if (!supabase) {
    return {
      sessionId: `mock-session-${Date.now()}`,
      customerNumber: 1,
      sessionDate: dateStr,
      status: 'open',
    };
  }

  // Fetch next sequential token via stored function
  const { data: nextToken, error: tokenError } = await supabase.rpc('get_next_customer_token', {
    p_date: dateStr,
  });

  const customerNumber = (!tokenError && typeof nextToken === 'number') ? nextToken : 1;

  const { data: newSession, error: insertError } = await supabase
    .from('sessions')
    .insert({
      session_date: dateStr,
      customer_number: customerNumber,
      status: 'open',
      subtotal: 0.00,
    })
    .select()
    .single();

  if (insertError || !newSession) {
    throw new Error(`Failed to create new session: ${insertError?.message || 'Unknown database error'}`);
  }

  return {
    sessionId: newSession.id,
    customerNumber: newSession.customer_number,
    sessionDate: newSession.session_date,
    status: newSession.status,
  };
}

/**
 * Main dispatcher: handles execution of Gemini tool calls against Supabase
 */
export async function dispatchToolCall(
  toolName: string,
  args: any,
  context: SessionContext
): Promise<ToolExecutionResult> {
  const supabase = getServerSupabase();

  switch (toolName) {
    case 'add_line_item':
      return handleAddLineItem(args, context, supabase);

    case 'edit_last_line_item':
      return handleEditLastLineItem(args, context, supabase);

    case 'update_catalog_price':
      return handleUpdateCatalogPrice(args, supabase);

    case 'close_bill':
      return handleCloseBill(context, supabase);

    case 'open_session':
      return handleOpenSession(args, context, supabase);

    case 'start_new_bill':
      return handleStartNewBill(context, supabase);

    default:
      return {
        status: 'error',
        message: `Unrecognized tool call: ${toolName}`,
        earcon: 'warning',
      };
  }
}

/**
 * Handler 1: add_line_item
 */
async function handleAddLineItem(
  args: { item_name: string; quantity_text: string; price_override?: number },
  context: SessionContext,
  supabase: any
): Promise<ToolExecutionResult> {
  if (!context?.sessionId) {
    return {
      status: 'no_active_session',
      message: 'No active session found. Please open or start a bill.',
      earcon: 'warning',
    };
  }

  const cleanItemName = (args.item_name || '').trim();
  const cleanQuantityText = (args.quantity_text || '').trim();

  if (!cleanItemName || !cleanQuantityText) {
    return {
      status: 'error',
      message: 'Missing item_name or quantity_text',
      earcon: 'warning',
    };
  }

  // 1. Resolve item via tiered matching
  const resolveRes: ResolveResult = await resolveItem(cleanItemName);

  if (resolveRes.status === 'not_found') {
    return {
      status: 'not_found',
      message: `Unrecognized item: "${cleanItemName}"`,
      earcon: 'warning',
      data: { query: cleanItemName },
    };
  }

  if (resolveRes.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      message: `Ambiguous item "${cleanItemName}". Multiple matches found.`,
      earcon: 'warning',
      data: {
        query: cleanItemName,
        candidates: resolveRes.candidates?.map((c) => ({
          id: c.id,
          canonical_name: c.canonical_name,
          current_price: c.current_price,
          unit_type: c.unit_type,
          similarity: c.similarity,
        })),
      },
    };
  }

  const resolved = resolveRes.item!;
  const targetUnit = resolved.unit_type as CatalogUnitType;

  // 2. Parse colloquial quantity deterministically
  const parseRes = parseSpokenQuantity(cleanQuantityText, targetUnit);

  if (!parseRes.valid) {
    return {
      status: 'unit_mismatch',
      message: parseRes.errorMessage || `Unit mismatch for ${resolved.canonical_name}`,
      earcon: 'warning',
      data: {
        item: resolved.canonical_name,
        spokenQuantity: cleanQuantityText,
        expectedCategory: parseRes.category,
      },
    };
  }

  // 3. Snapshot unit price at add-time (mid-bill price immutability per HLD §3.10)
  const isOverride = typeof args.price_override === 'number' && args.price_override > 0 && args.price_override !== resolved.current_price;
  const unitPriceUsed = isOverride ? (args.price_override as number) : resolved.current_price;

  // Calculate line total: normalizedQuantity * unitPrice, rounded to 2 decimal places
  const lineTotal = Math.round(parseRes.normalizedQuantity * unitPriceUsed * 100) / 100;

  // 4. Insert row into session_items
  if (supabase) {
    const { data: lineItem, error: insertError } = await supabase
      .from('session_items')
      .insert({
        session_id: context.sessionId,
        item_id: resolved.id || (resolved as any).item_id,
        quantity: parseRes.normalizedQuantity,
        unit: parseRes.targetUnit,
        spoken_quantity_label: parseRes.spokenLabel,
        unit_price_used: unitPriceUsed,
        is_price_override: isOverride,
        line_total: lineTotal,
      })
      .select()
      .single();

    if (insertError || !lineItem) {
      console.error('[Dispatcher] session_items insert error:', insertError);
      return {
        status: 'error',
        message: `Database write failed: ${insertError?.message || 'Unknown'}`,
        earcon: 'warning',
      };
    }

    return {
      status: 'ok',
      message: `Added ${parseRes.spokenLabel} ${resolved.canonical_name} at Rs ${unitPriceUsed}`,
      earcon: 'chime',
      data: {
        line_item_id: lineItem.id,
        canonical_name: resolved.canonical_name,
        quantity: parseRes.normalizedQuantity,
        unit: parseRes.targetUnit,
        spoken_label: parseRes.spokenLabel,
        unit_price: unitPriceUsed,
        is_price_override: isOverride,
        line_total: lineTotal,
      },
    };
  }

  // Mock / offline fallback response
  return {
    status: 'ok',
    message: `Added ${parseRes.spokenLabel} ${resolved.canonical_name}`,
    earcon: 'chime',
    data: {
      canonical_name: resolved.canonical_name,
      quantity: parseRes.normalizedQuantity,
      unit: parseRes.targetUnit,
      spoken_label: parseRes.spokenLabel,
      unit_price: unitPriceUsed,
      line_total: lineTotal,
    },
  };
}

/**
 * Handler 2: edit_last_line_item
 */
async function handleEditLastLineItem(
  args: { correction_type: 'change_item' | 'change_quantity' | 'change_price' | 'delete_row'; new_value?: string },
  context: SessionContext,
  supabase: any
): Promise<ToolExecutionResult> {
  if (!supabase) {
    return {
      status: 'ok',
      message: `Mock edited last line item (${args.correction_type})`,
      earcon: 'chime',
    };
  }

  // Find the last row in the active session
  const { data: lastItem, error: findError } = await supabase
    .from('session_items')
    .select('*, items(canonical_name, unit_type, current_price)')
    .eq('session_id', context.sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (findError || !lastItem) {
    return {
      status: 'not_found',
      message: 'No line item found in current session to edit.',
      earcon: 'warning',
    };
  }

  switch (args.correction_type) {
    case 'delete_row': {
      const { error: deleteError } = await supabase
        .from('session_items')
        .delete()
        .eq('id', lastItem.id);

      if (deleteError) {
        return { status: 'error', message: deleteError.message, earcon: 'warning' };
      }

      return {
        status: 'ok',
        message: `Removed ${lastItem.items?.canonical_name || 'last item'} from bill.`,
        earcon: 'chime',
        data: { deleted_id: lastItem.id },
      };
    }

    case 'change_quantity': {
      if (!args.new_value) {
        return { status: 'error', message: 'Missing new quantity value', earcon: 'warning' };
      }

      const unitType = lastItem.items?.unit_type || lastItem.unit;
      const parseRes = parseSpokenQuantity(args.new_value, unitType);

      if (!parseRes.valid) {
        return {
          status: 'unit_mismatch',
          message: parseRes.errorMessage || 'Invalid quantity format',
          earcon: 'warning',
        };
      }

      const newLineTotal = Math.round(parseRes.normalizedQuantity * lastItem.unit_price_used * 100) / 100;

      const { error: updateError } = await supabase
        .from('session_items')
        .update({
          quantity: parseRes.normalizedQuantity,
          unit: parseRes.targetUnit,
          spoken_quantity_label: parseRes.spokenLabel,
          line_total: newLineTotal,
        })
        .eq('id', lastItem.id);

      if (updateError) {
        return { status: 'error', message: updateError.message, earcon: 'warning' };
      }

      return {
        status: 'ok',
        message: `Updated quantity to ${parseRes.spokenLabel} (Rs ${newLineTotal})`,
        earcon: 'chime',
        data: {
          updated_id: lastItem.id,
          quantity: parseRes.normalizedQuantity,
          unit: parseRes.targetUnit,
          line_total: newLineTotal,
        },
      };
    }

    case 'change_price': {
      if (!args.new_value) {
        return { status: 'error', message: 'Missing new price value', earcon: 'warning' };
      }

      const parsedPrice = parseFloat(args.new_value.replace(/[^0-9.]/g, ''));
      if (isNaN(parsedPrice) || parsedPrice <= 0) {
        return { status: 'error', message: `Invalid price: "${args.new_value}"`, earcon: 'warning' };
      }

      const newLineTotal = Math.round(lastItem.quantity * parsedPrice * 100) / 100;

      const { error: updateError } = await supabase
        .from('session_items')
        .update({
          unit_price_used: parsedPrice,
          is_price_override: true,
          line_total: newLineTotal,
        })
        .eq('id', lastItem.id);

      if (updateError) {
        return { status: 'error', message: updateError.message, earcon: 'warning' };
      }

      return {
        status: 'ok',
        message: `Updated unit price to Rs ${parsedPrice} (Total: Rs ${newLineTotal})`,
        earcon: 'chime',
        data: {
          updated_id: lastItem.id,
          unit_price: parsedPrice,
          line_total: newLineTotal,
        },
      };
    }

    case 'change_item': {
      if (!args.new_value) {
        return { status: 'error', message: 'Missing replacement item name', earcon: 'warning' };
      }

      const resolveRes = await resolveItem(args.new_value);
      if (resolveRes.status !== 'ok' || !resolveRes.item) {
        return {
          status: resolveRes.status,
          message: `Could not resolve replacement item "${args.new_value}"`,
          earcon: 'warning',
          data: resolveRes.candidates,
        };
      }

      const newItem = resolveRes.item;
      const targetUnit = newItem.unit_type as CatalogUnitType;
      // Re-parse current quantity against new item unit
      const parseRes = parseSpokenQuantity(lastItem.spoken_quantity_label || `${lastItem.quantity} ${lastItem.unit}`, targetUnit);

      if (!parseRes.valid) {
        return {
          status: 'unit_mismatch',
          message: `Cannot switch to ${newItem.canonical_name}: unit mismatch (${lastItem.unit} -> ${targetUnit})`,
          earcon: 'warning',
        };
      }

      const newLineTotal = Math.round(parseRes.normalizedQuantity * newItem.current_price * 100) / 100;

      const { error: updateError } = await supabase
        .from('session_items')
        .update({
          item_id: newItem.id || (newItem as any).item_id,
          quantity: parseRes.normalizedQuantity,
          unit: parseRes.targetUnit,
          unit_price_used: newItem.current_price,
          is_price_override: false,
          line_total: newLineTotal,
        })
        .eq('id', lastItem.id);

      if (updateError) {
        return { status: 'error', message: updateError.message, earcon: 'warning' };
      }

      return {
        status: 'ok',
        message: `Changed item to ${newItem.canonical_name} (Total: Rs ${newLineTotal})`,
        earcon: 'chime',
        data: {
          updated_id: lastItem.id,
          canonical_name: newItem.canonical_name,
          line_total: newLineTotal,
        },
      };
    }
  }
}

/**
 * Handler 3: update_catalog_price (with price_history audit trail)
 */
async function handleUpdateCatalogPrice(
  args: { item_name: string; new_price: number },
  supabase: any
): Promise<ToolExecutionResult> {
  const cleanItemName = (args.item_name || '').trim();
  const newPrice = typeof args.new_price === 'number' ? args.new_price : parseFloat(args.new_price);

  if (!cleanItemName || isNaN(newPrice) || newPrice < 0) {
    return {
      status: 'error',
      message: 'Invalid item_name or new_price',
      earcon: 'warning',
    };
  }

  const resolveRes = await resolveItem(cleanItemName);
  if (resolveRes.status !== 'ok' || !resolveRes.item) {
    return {
      status: resolveRes.status,
      message: `Cannot update rate: item "${cleanItemName}" not found`,
      earcon: 'warning',
    };
  }

  const item = resolveRes.item;
  const oldPrice = item.current_price;
  const itemId = item.id || (item as any).item_id;

  if (supabase) {
    // 1. Audit log into price_history
    await supabase.from('price_history').insert({
      item_id: itemId,
      old_price: oldPrice,
      new_price: newPrice,
    });

    // 2. Update canonical price in items table
    const { error: updateError } = await supabase
      .from('items')
      .update({ current_price: newPrice })
      .eq('id', itemId);

    if (updateError) {
      return {
        status: 'error',
        message: `Failed to update catalog: ${updateError.message}`,
        earcon: 'warning',
      };
    }
  }

  return {
    status: 'ok',
    message: `Updated catalog price of ${item.canonical_name} from Rs ${oldPrice} to Rs ${newPrice}/${item.unit_type}`,
    earcon: 'chime',
    data: {
      canonical_name: item.canonical_name,
      old_price: oldPrice,
      new_price: newPrice,
      unit: item.unit_type,
    },
  };
}

/**
 * Handler 4: close_bill
 */
async function handleCloseBill(context: SessionContext, supabase: any): Promise<ToolExecutionResult> {
  if (!context?.sessionId) {
    return {
      status: 'no_active_session',
      message: 'No open session to close',
      earcon: 'warning',
    };
  }

  let subtotal = 0.00;

  if (supabase) {
    const { data: updatedSession, error } = await supabase
      .from('sessions')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
      })
      .eq('id', context.sessionId)
      .select()
      .single();

    if (error) {
      return {
        status: 'error',
        message: `Failed to close session: ${error.message}`,
        earcon: 'warning',
      };
    }

    subtotal = updatedSession.subtotal;
  }

  return {
    status: 'ok',
    message: `Bill closed. Total: Rs ${subtotal}`,
    earcon: 'chime',
    data: {
      session_id: context.sessionId,
      subtotal,
      status: 'closed',
    },
    contextUpdate: { status: 'closed' },
  };
}

/**
 * Handler 5: open_session
 */
async function handleOpenSession(
  args: { token_number: number },
  context: SessionContext,
  supabase: any
): Promise<ToolExecutionResult> {
  const tokenNum = typeof args.token_number === 'number' ? args.token_number : parseInt(args.token_number, 10);
  const todayIST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

  if (!supabase) {
    return {
      status: 'ok',
      message: `Opened session token #${tokenNum}`,
      earcon: 'chime',
      contextUpdate: {
        sessionId: `mock-session-token-${tokenNum}`,
        customerNumber: tokenNum,
        status: 'resumed',
      },
    };
  }

  const { data: session, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('session_date', todayIST)
    .eq('customer_number', tokenNum)
    .single();

  if (error || !session) {
    return {
      status: 'not_found',
      message: `Token #${tokenNum} not found for today.`,
      earcon: 'warning',
    };
  }

  // If closed, reopen/resume
  if (session.status === 'closed') {
    await supabase.from('sessions').update({ status: 'resumed' }).eq('id', session.id);
  }

  return {
    status: 'ok',
    message: `Opened Token #${session.customer_number} (Subtotal: Rs ${session.subtotal})`,
    earcon: 'chime',
    data: {
      session_id: session.id,
      customer_number: session.customer_number,
      subtotal: session.subtotal,
      status: 'resumed',
    },
    contextUpdate: {
      sessionId: session.id,
      customerNumber: session.customer_number,
      sessionDate: session.session_date,
      status: 'resumed',
    },
  };
}

/**
 * Handler 6: start_new_bill
 */
async function handleStartNewBill(context: SessionContext, supabase: any): Promise<ToolExecutionResult> {
  try {
    const newContext = await createNewSession(supabase);

    return {
      status: 'ok',
      message: `Started new bill (Token #${newContext.customerNumber})`,
      earcon: 'chime',
      data: {
        session_id: newContext.sessionId,
        customer_number: newContext.customerNumber,
        session_date: newContext.sessionDate,
        subtotal: 0.00,
      },
      contextUpdate: newContext,
    };
  } catch (err: any) {
    return {
      status: 'error',
      message: `Failed to create new bill: ${err.message}`,
      earcon: 'warning',
    };
  }
}
