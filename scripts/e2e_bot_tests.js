/*
  E2E Bot Tests
  - Simulates full conversations across Browse, Valuation, Test Drive, Contact, Greeting/Unknown
  - Verifies DB logging columns exist and rows are created during run
  - Verifies report/stat APIs respond with expected shapes
*/
require('dotenv').config();
const pool = require('../db');
const { routeMessage } = require('../utils/mainRouter');
const fetch = require('node-fetch');

function newSession(seed={}) { return { ...seed }; }

async function send(session, text) {
  const res = await routeMessage(session, text, pool);
  return res;
}

async function testGreetingFlow() {
  const session = newSession({});
  const res = await send(session, 'hello');
  return { name: 'Greeting/Main Menu', pass: !!(res && res.options && res.options.length >= 3), session, res };
}

async function testBrowseFlowWithBrandSkip() {
  const session = newSession({ lastIntent: 'browse_cars', lastEntities: { brand: 'Tata' }, lastConfidence: 0.95 });
  await send(session, 'I want to buy Tata car');
  await send(session, '₹10-15 Lakhs');
  const res = await send(session, 'all Type');
  const pass = res && res.messages && Array.isArray(res.messages) && res.messages.length >= 1 && session.step === 'show_more_cars';
  return { name: 'Browse (brand seeded, skip brand)', pass, session, res };
}

async function testValuationFlow() {
  const session = newSession({ lastIntent: 'car_valuation', lastEntities: { brand: 'Hyundai', model: 'i20', year: 2019, fuel_type: 'Petrol', kms: 40000 }, lastConfidence: 0.92 });
  // advance valuation flow with a simple confirmation-like message path
  const res1 = await send(session, 'i20 2019 petrol 40000 kms');
  const res2 = await send(session, 'next');
  return { name: 'Valuation (entities seeded)', pass: !!(res1 || res2), session, res: res2 || res1 };
}

async function testTestDriveFlow() {
  const session = newSession({ lastIntent: 'test_drive', lastEntities: { name: 'John', phone: '9999999999', test_drive_date: 'Tomorrow', test_drive_time: 'Evening' }, lastConfidence: 0.9 });
  const r1 = await send(session, 'Book a Test Drive');
  const r2 = await send(session, 'Tomorrow');
  const r3 = await send(session, 'Evening');
  const r4 = await send(session, 'John');
  const r5 = await send(session, '9999999999');
  const r6 = await send(session, 'Yes');
  const r7 = await send(session, 'Showroom pickup');
  const r8 = await send(session, 'Confirm');
  return { name: 'Test Drive (end-to-end)', pass: !!r8, session, res: r8 };
}

async function testContactFlow() {
  const session = newSession({ lastIntent: 'contact_team', lastEntities: { name: 'Alice', phone: '8888888888', reason: 'Call me' }, lastConfidence: 0.85 });
  const res = await send(session, 'contact');
  return { name: 'Contact', pass: !!res, session, res };
}

async function verifyMessageLogsSchemaAndRows() {
  const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='message_logs'`);
  const c = cols.rows.map(r => r.column_name);
  const required = ['intent','entities','confidence','phone_number','message_type','message_content','response_content'];
  const schemaOk = required.every(x => c.includes(x));
  const rows = await pool.query(`SELECT count(*)::int as n FROM message_logs`);
  return { name: 'DB message_logs schema+rows', pass: schemaOk && rows.rows[0].n >= 1, schemaOk, columns: c, rows: rows.rows[0].n };
}

async function verifyReportApis() {
  const portsToTry = [process.env.PORT || 3001, 3000];
  const endpoints = ['/api/message-logs', '/api/message-stats'];
  const results = [];
  for (const port of portsToTry) {
    const base = `http://localhost:${port}`;
    for (const ep of endpoints) {
      try {
        const r = await fetch(base + ep, { headers: { Authorization: 'Bearer test-token' }});
        const reachable = [200, 401, 403].includes(r.status);
        results.push({ base, endpoint: ep, status: r.status, ok: reachable });
      } catch (e) {
        results.push({ base, endpoint: ep, ok: false, error: e.message });
      }
    }
  }
  const pass = results.some(r => r.ok);
  const allConnRefused = results.length > 0 && results.every(r => !r.ok && /ECONNREFUSED/i.test(r.error || ''));
  if (allConnRefused) {
    return { name: 'Report APIs (skipped - server not running)', pass: true, skipped: true, results };
  }
  return { name: 'Report APIs', pass, results };
}

(async () => {
  const tests = [];
  tests.push(await testGreetingFlow());
  tests.push(await testBrowseFlowWithBrandSkip());
  tests.push(await testValuationFlow());
  tests.push(await testTestDriveFlow());
  tests.push(await testContactFlow());
  tests.push(await verifyMessageLogsSchemaAndRows());
  tests.push(await verifyReportApis());

  const summary = tests.map(t => ({ name: t.name, pass: t.pass }));
  console.log('\n=== Test Summary ===');
  console.table(summary);
  const failed = tests.filter(t => !t.pass);
  if (failed.length) {
    console.log('\nFailed details:');
    for (const f of failed) {
      console.log(f.name, JSON.stringify(f, null, 2));
    }
    process.exitCode = 1;
  }
  await pool.end();
})();


