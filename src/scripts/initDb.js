// Run with:  npm run db:init
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pool from '../config/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, '../../src/init-db.sql'), 'utf8');

async function init() {
  const client = await pool.connect();
  try {
    console.log('🔄  Running init-db.sql against Neon...');
    await client.query(sql);
    console.log('✅  Database initialized successfully!');
    console.log('    Default login → username: admin  password: admin123');
  } catch (err) {
    console.error('❌  Init failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

init();
