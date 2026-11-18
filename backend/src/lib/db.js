'use strict';
// PostgreSQL access. Three modes, chosen by environment variables set by Terraform:
//
//  1. Through RDS Proxy (production design, DB_SECRET_ARN not set):
//     IAM authentication – the Lambda role signs a short-lived token; RDS Proxy pools
//     connections and fetches the real credentials from Secrets Manager itself.
//  2. Directly to RDS (AWS Free plan accounts, where RDS Proxy is not available; DB_SECRET_ARN set):
//     the password is read from the RDS-managed secret in Secrets Manager (cached, never logged),
//     and TLS is verified against Amazon's RDS certificate bundle.
//  3. Local development (DB_PASSWORD set): Docker PostgreSQL, plain password, no TLS.
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

let pool;
let secretCache = { value: null, at: 0 };
const SECRET_TTL_MS = 5 * 60 * 1000; // re-read after RDS rotates the password

async function secretPassword() {
  if (secretCache.value && Date.now() - secretCache.at < SECRET_TTL_MS) return secretCache.value;
  const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
  const res = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN }));
  secretCache = { value: JSON.parse(res.SecretString).password, at: Date.now() };
  return secretCache.value;
}

function getPool() {
  if (pool) return pool;
  const { DB_HOST, DB_USER, DB_NAME, DB_PASSWORD, DB_PORT, DB_SECRET_ARN, AWS_REGION } = process.env;
  const port = Number(DB_PORT || 5432);
  let password;
  let ssl;
  if (DB_PASSWORD) {
    password = DB_PASSWORD;
    ssl = false;
  } else if (DB_SECRET_ARN) {
    password = secretPassword;
    ssl = { rejectUnauthorized: true, ca: fs.readFileSync(path.join(__dirname, '..', '..', 'certs', 'rds-global-bundle.pem'), 'utf8') };
  } else {
    const { Signer } = require('@aws-sdk/rds-signer');
    const signer = new Signer({ hostname: DB_HOST, port, username: DB_USER, region: AWS_REGION });
    password = () => signer.getAuthToken(); // token is regenerated for every new connection
    ssl = { rejectUnauthorized: true };     // RDS Proxy uses an ACM (Amazon Trust Services) certificate
  }
  pool = new Pool({
    host: DB_HOST,
    port,
    user: DB_USER,
    database: DB_NAME,
    password,
    ssl,
    // A Lambda instance handles one request at a time, so one connection is enough.
    // Without RDS Proxy this keeps total connections = number of warm Lambda instances.
    max: DB_PASSWORD ? 10 : 1,
    idleTimeoutMillis: DB_SECRET_ARN ? 30000 : 60000,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', (err) => {
    console.error(JSON.stringify({ level: 'error', message: `idle client error: ${err.message}` }));
    if (err.code === '28P01') secretCache = { value: null, at: 0 }; // password rotated
  });
  return pool;
}

async function query(text, params) {
  try {
    return await getPool().query(text, params);
  } catch (err) {
    if (err.code === '28P01' && process.env.DB_SECRET_ARN) { // password was rotated: refresh once
      secretCache = { value: null, at: 0 };
      await pool.end().catch(() => {});
      pool = undefined;
      return getPool().query(text, params);
    }
    throw err;
  }
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
