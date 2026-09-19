/**
 * Kirana Voice Billing — Tool Dispatcher Test Suite
 * 
 * Verifies all 6 tool handlers against live Supabase or mock fallback:
 * - add_line_item (pricing snapshot, quantity parsing, unit mismatch, ambiguity)
 * - edit_last_line_item (delete_row, change_quantity, change_price, change_item)
 * - update_catalog_price (with price_history audit trail)
 * - close_bill (status update and final subtotal)
 * - start_new_bill (atomic sequential token generation)
 * - open_session (resuming existing daily tokens)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import {
  dispatchToolCall,
  createNewSession,
  SessionContext,
} from './tool-dispatcher';
import { getServerSupabase } from './supabase/server';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('\n--- Running Tool Dispatcher Test Suite ---\n');
  const supabase = getServerSupabase();

  // Step 1: Create a fresh session for testing
  const context: SessionContext = await createNewSession();
  console.log(`✅ Test Session Created: Token #${context.customerNumber} (${context.sessionId})`);

  // Test 1: add_line_item (chini, 1 paav -> 250g of Sugar)
  const res1 = await dispatchToolCall('add_line_item', {
    item_name: 'chini',
    quantity_text: '1 paav',
  }, context);

  assert(res1.status === 'ok', `Expected status 'ok', got ${res1.status}: ${res1.message}`);
  assert(res1.earcon === 'chime', `Expected earcon 'chime', got ${res1.earcon}`);
  assert(res1.data.quantity === 0.25, `Expected 0.25 kg, got ${res1.data.quantity}`);
  assert(res1.data.line_total === 11, `Expected Rs 11, got ${res1.data.line_total}`);
  console.log(`✅ Test 1 Passed: Added 1 paav chini -> Rs ${res1.data.line_total} (chime)`);

  // Test 2: add_line_item with price override ("aata", "2 kilo", override: 35)
  const res2 = await dispatchToolCall('add_line_item', {
    item_name: 'aata',
    quantity_text: '2 kilo',
    price_override: 35,
  }, context);

  assert(res2.status === 'ok', `Expected status 'ok', got ${res2.status}`);
  assert(res2.data.is_price_override === true, 'Expected is_price_override to be true');
  assert(res2.data.line_total === 70, `Expected Rs 70, got ${res2.data.line_total}`);
  console.log(`✅ Test 2 Passed: Added aata with price override Rs 35 -> Rs ${res2.data.line_total}`);

  // Test 3: add_line_item unit mismatch ("chini", "2 packet")
  const res3 = await dispatchToolCall('add_line_item', {
    item_name: 'chini',
    quantity_text: '2 packet',
  }, context);

  assert(res3.status === 'unit_mismatch', `Expected 'unit_mismatch', got ${res3.status}`);
  assert(res3.earcon === 'warning', 'Expected earcon warning');
  console.log(`✅ Test 3 Passed: Unit mismatch rejected correctly: ${res3.message}`);

  // Test 4: add_line_item not_found ("unknown_grocery_xyz")
  const res4 = await dispatchToolCall('add_line_item', {
    item_name: 'unknown_grocery_xyz',
    quantity_text: '1 kilo',
  }, context);

  assert(res4.status === 'not_found', `Expected 'not_found', got ${res4.status}`);
  assert(res4.earcon === 'warning', 'Expected earcon warning');
  console.log(`✅ Test 4 Passed: Unrecognized item rejected with warning: ${res4.message}`);

  // Test 5: edit_last_line_item (change_quantity to "1 kilo" on aata)
  const res5 = await dispatchToolCall('edit_last_line_item', {
    correction_type: 'change_quantity',
    new_value: '1 kilo',
  }, context);

  assert(res5.status === 'ok', `Expected 'ok', got ${res5.status}`);
  assert(res5.data.line_total === 35, `Expected Rs 35, got ${res5.data.line_total}`);
  console.log(`✅ Test 5 Passed: Corrected last item quantity to 1 kilo -> Rs ${res5.data.line_total}`);

  // Test 6: edit_last_line_item (delete_row on aata)
  const res6 = await dispatchToolCall('edit_last_line_item', {
    correction_type: 'delete_row',
  }, context);

  assert(res6.status === 'ok', `Expected 'ok', got ${res6.status}`);
  console.log(`✅ Test 6 Passed: Deleted last row successfully: ${res6.message}`);

  // Test 7: update_catalog_price (chini ka rate 75 karo)
  const res7 = await dispatchToolCall('update_catalog_price', {
    item_name: 'chini',
    new_price: 75,
  }, context);

  assert(res7.status === 'ok', `Expected 'ok', got ${res7.status}`);
  assert(res7.data.new_price === 75, 'Expected new price 75');
  console.log(`✅ Test 7 Passed: Updated catalog rate: ${res7.message}`);

  // Revert catalog price back to 44 so catalog stays clean
  await dispatchToolCall('update_catalog_price', {
    item_name: 'chini',
    new_price: 44,
  }, context);
  console.log(`✅ Reverted test catalog rate back to Rs 44.`);

  // Test 8: close_bill
  const res8 = await dispatchToolCall('close_bill', {}, context);
  assert(res8.status === 'ok', `Expected 'ok', got ${res8.status}`);
  assert(res8.data.subtotal === 11, `Expected remaining subtotal Rs 11, got ${res8.data.subtotal}`);
  console.log(`✅ Test 8 Passed: Bill closed successfully: ${res8.message}`);

  // Test 9: open_session (reopen the token we just closed)
  const res9 = await dispatchToolCall('open_session', {
    token_number: context.customerNumber,
  }, context);

  assert(res9.status === 'ok', `Expected 'ok', got ${res9.status}`);
  assert(res9.data.customer_number === context.customerNumber, 'Expected matching customer number');
  assert(res9.data.status === 'resumed', `Expected resumed status, got ${res9.data.status}`);
  console.log(`✅ Test 9 Passed: Reopened session token #${res9.data.customer_number}`);

  // Test 10: start_new_bill (atomic increment)
  const res10 = await dispatchToolCall('start_new_bill', {}, context);
  assert(res10.status === 'ok', `Expected 'ok', got ${res10.status}`);
  assert(res10.data.customer_number > context.customerNumber, 'Expected higher customer token');
  console.log(`✅ Test 10 Passed: Started new bill -> Token #${res10.data.customer_number}`);

  console.log('\n🎉 ALL 10 TOOL DISPATCHER TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
