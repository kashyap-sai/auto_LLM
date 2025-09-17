const { Pool } = require('pg');
require('dotenv').config();

console.log('🔍 Database connection setup:');
console.log('🔍 DATABASE_URL exists:', !!process.env.DATABASE_URL);
console.log('🔍 DATABASE_URL length:', process.env.DATABASE_URL ? process.env.DATABASE_URL.length : 0);

// Connection configuration with conditional SSL
const connectionString = process.env.DATABASE_URL;
const urlString = connectionString || '';
const sslRequiredByUrl = /sslmode=require/i.test(urlString);
const isKnownManagedHost = /neon\.tech|render\.com|amazonaws\.com/i.test(urlString);
const envSslFlag = (process.env.DATABASE_SSL || '').toLowerCase(); // 'require' | 'disable' | ''

const useSSL = envSslFlag === 'require' || (envSslFlag !== 'disable' && (sslRequiredByUrl || isKnownManagedHost));

console.log('🔍 DB SSL decision:', { sslRequiredByUrl, isKnownManagedHost, envSslFlag, useSSL });

const pool = new Pool({
    connectionString,
    ssl: useSSL ? { rejectUnauthorized: false } : false
});

// Test the connection
pool.on('connect', () => {
    console.log('✅ Connected to PostgreSQL successfully');
});

pool.on('error', (err) => {
    console.error('❌ Unexpected error on idle client', err);
    process.exit(-1);
});

console.log('🔍 Pool created successfully, type:', typeof pool);
console.log('🔍 Pool has query method:', typeof pool.query === 'function');

module.exports = pool;
