'use strict';
// Creates/updates the database schema. Invoked by Terraform (aws_lambda_invocation)
// on every deploy where the code or schema.sql changed, so the database is reproducible from code.
const fs = require('node:fs');
const path = require('node:path');
const db = require('../lib/db');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.handler = async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  // On the first deploy RDS Proxy may still be registering its target; retry for up to ~4 minutes.
  for (let attempt = 1; ; attempt++) {
    try {
      await db.query(sql);
      break;
    } catch (err) {
      if (attempt >= 16) throw err;
      console.warn(`Migration attempt ${attempt} failed (${err.message}); retrying in 15s`);
      await sleep(15000);
    }
  }
  const { rows } = await db.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`);
  return { ok: true, tables: rows.map((r) => r.table_name) };
};
