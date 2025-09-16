/*
  Smoke tests for browse flow and intent routing behavior.
  - Verifies brand is not re-asked when already present in session
  - Verifies low-confidence clarification is NOT triggered during active flow
*/
require('dotenv').config();
const pool = require('../db');
const { routeMessage } = require('../utils/mainRouter');

async function runBrowseFlowBrandSkip() {
  const session = {};
  const outputs = [];

  // Seed Gemini extraction: intent browse, brand Mahindra, high confidence
  session.lastIntent = 'browse_cars';
  session.lastEntities = { brand: 'Mahindra' };
  session.lastConfidence = 0.95;

  // 1) User initial message
  outputs.push(await routeMessage(session, 'Hi i want to buy Mahindra car', pool));

  // 2) Budget selection
  outputs.push(await routeMessage(session, '₹10-15 Lakhs', pool));

  // 3) Type selection (choose all Type)
  outputs.push(await routeMessage(session, 'all Type', pool));

  return { session, outputs };
}

async function runNoClarifyDuringActiveFlow() {
  const session = {
    step: 'browse_type',
    budget: '₹10-15 Lakhs',
    lastIntent: 'general',
    lastEntities: {},
    lastConfidence: 0.2 // low
  };
  const result = await routeMessage(session, 'all Type', pool);
  return { session, result };
}

async function checkMessageLogsColumns() {
  try {
    const res = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='message_logs'`);
    const cols = res.rows.map(r => r.column_name);
    return cols;
  } catch (e) {
    return { error: e.message };
  }
}

(async () => {
  console.log('--- Smoke Test: Brand Skip in Browse Flow ---');
  const a = await runBrowseFlowBrandSkip();
  a.outputs.forEach((o, idx) => {
    console.log(`Step ${idx + 1} -> message:`, o && o.message);
    console.log(`Step ${idx + 1} -> options:`, o && o.options);
    console.log(`Step ${idx + 1} -> extra messages:`, o && o.messages && o.messages.length);
  });
  console.log('Final session:', JSON.stringify(a.session, null, 2));

  console.log('\n--- Smoke Test: No Clarify During Active Flow ---');
  const b = await runNoClarifyDuringActiveFlow();
  console.log('Response message:', b.result && b.result.message);
  console.log('Response options:', b.result && b.result.options);
  console.log('Session step after:', b.session.step);

  console.log('\n--- DB Columns: message_logs ---');
  const cols = await checkMessageLogsColumns();
  console.log(cols);

  await pool.end();
})();


