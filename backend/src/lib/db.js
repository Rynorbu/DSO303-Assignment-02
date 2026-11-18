'use strict';
// PostgreSQL access through RDS Proxy using IAM authentication.
// No password is stored anywhere: the Lambda role signs a short-lived token,
// and RDS Proxy fetches the real credentials from Secrets Manager itself.
const { Pool } = require('pg');
const { Signer } = require('@aws-sdk/rds-signer');

let pool;

function getPool() {
  if (pool) return pool;
  const { DB_HOST, DB_USER, DB_NAME, AWS_REGION } = process.env;
  const signer = new Signer({ hostname: DB_HOST, port: 5432, username: DB_USER, region: AWS_REGION });
  pool = new Pool({
    host: DB_HOST,
    port: 5432,
    user: DB_USER,
    database: DB_NAME,
    password: () => signer.getAuthToken(), // token is regenerated for every new connection
    ssl: { rejectUnauthorized: true },      // RDS Proxy uses an ACM (Amazon Trust Services) cert
    max: 2,                                  // one Lambda instance handles one request at a time
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 5000,
  });
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { query, withTransaction };
