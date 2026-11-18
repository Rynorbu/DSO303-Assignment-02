'use strict';
// PostgreSQL access.
//  - On AWS: through RDS Proxy using IAM authentication. No password is stored anywhere:
//    the Lambda role signs a short-lived token and RDS Proxy fetches the real credentials
//    from Secrets Manager itself.
//  - Locally: DB_PASSWORD is set (Docker PostgreSQL), plain password, no TLS.
const { Pool } = require('pg');

let pool;

function getPool() {
  if (pool) return pool;
  const { DB_HOST, DB_USER, DB_NAME, DB_PASSWORD, DB_PORT, AWS_REGION } = process.env;
  const port = Number(DB_PORT || 5432);
  let password;
  let ssl;
  if (DB_PASSWORD) {
    password = DB_PASSWORD;
    ssl = false;
  } else {
    const { Signer } = require('@aws-sdk/rds-signer');
    const signer = new Signer({ hostname: DB_HOST, port, username: DB_USER, region: AWS_REGION });
    password = () => signer.getAuthToken(); // token is regenerated for every new connection
    ssl = { rejectUnauthorized: true };     // RDS Proxy uses an ACM (Amazon Trust Services) cert
  }
  pool = new Pool({
    host: DB_HOST,
    port,
    user: DB_USER,
    database: DB_NAME,
    password,
    ssl,
    max: DB_PASSWORD ? 10 : 2, // a Lambda instance handles one request at a time
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
