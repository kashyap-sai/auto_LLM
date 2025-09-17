/*
  Import brand-model pairs from an Excel file into public.car_brands_models

  Usage:
    node import/import_brand_models.js "./Brand vs mode.xlsx"

  - If no path is provided, defaults to ./data/brand_models.xlsx
  - Ensures table and unique index exist
  - Upserts (ignores duplicates)
*/

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { Pool } = require('pg');
require('dotenv').config();

async function ensureTable(pool) {
  const ddl = `
    CREATE TABLE IF NOT EXISTS public.car_brands_models (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      model TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_car_brands_models_brand_model
      ON public.car_brands_models (brand, model);
  `;
  await pool.query(ddl);
}

function normalizeCell(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function readExcelRows(filePath) {
  const workbook = XLSX.readFile(filePath);
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  // Expect headers like: Brand, Model (case-insensitive)
  return rows.map(r => {
    const brand = normalizeCell(r.Brand || r.brand || r.MAKE || r.make || r.Make);
    const model = normalizeCell(r.Model || r.model || r.MODEL);
    return { brand, model };
  }).filter(r => r.brand && r.model);
}

async function upsertRows(pool, rows) {
  // Use conflict target by columns; requires a unique index on (brand, model)
  const text = 'INSERT INTO public.car_brands_models (brand, model) VALUES ($1, $2) ON CONFLICT (brand, model) DO NOTHING';
  let inserted = 0, skipped = 0;
  for (const { brand, model } of rows) {
    try {
      await pool.query(text, [brand, model]);
      inserted++;
    } catch (e) {
      if (e.code === '23505') {
        skipped++;
      } else {
        console.error('Row error:', brand, model, e.message);
        skipped++;
      }
    }
  }
  return { inserted, skipped };
}

async function main() {
  const inputArg = process.argv[2];
  const defaultPath = path.resolve(process.cwd(), 'data', 'brand_models.xlsx');
  const filePath = path.resolve(process.cwd(), inputArg || defaultPath);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ Excel file not found at: ${filePath}`);
    console.error('Provide a path like: node import/import_brand_models.js "./Brand vs mode.xlsx"');
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('❌ DATABASE_URL not set in environment');
    process.exit(1);
  }

  const urlString = connectionString || '';
  const sslRequiredByUrl = /sslmode=require/i.test(urlString);
  const isKnownManagedHost = /neon\.tech|render\.com|amazonaws\.com/i.test(urlString);
  const envSslFlag = (process.env.DATABASE_SSL || '').toLowerCase();
  const useSSL = envSslFlag === 'require' || (envSslFlag !== 'disable' && (sslRequiredByUrl || isKnownManagedHost));

  const pool = new Pool({ connectionString, ssl: useSSL ? { rejectUnauthorized: false } : false });

  try {
    console.log('📄 Reading Excel:', filePath);
    const rows = readExcelRows(filePath);
    console.log(`🧾 Parsed rows: ${rows.length}`);

    await ensureTable(pool);
    console.log('🗂️ Table ready: public.car_brands_models');

    const { inserted, skipped } = await upsertRows(pool, rows);
    console.log(`✅ Done. Inserted: ${inserted}, Skipped (duplicates/errors): ${skipped}`);
  } catch (err) {
    console.error('❌ Import failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();


