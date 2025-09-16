require('dotenv').config();
const { Pool } = require('pg');

function buildPoolFromEnv() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  const needsSSL = /neon|sslmode=require|render|railway/i.test(connectionString);
  return new Pool({ connectionString, ssl: needsSSL ? { rejectUnauthorized: false } : false });
}

async function migrate() {
  const pool = buildPoolFromEnv();
  const sql = `
    ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS intent VARCHAR(50);
    ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS entities JSONB;
    ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS confidence NUMERIC(3,2);
    CREATE INDEX IF NOT EXISTS idx_message_logs_intent ON message_logs(intent);
  `;
  try {
    await pool.query(sql);
    console.log('✅ Migration applied: message_logs intent/entities/confidence');
  } catch (e) {
    console.error('❌ Migration error:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();


