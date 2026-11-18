'use strict';
/*
 * Local development server: runs the SAME Lambda handlers as AWS, on your laptop.
 *
 *   AWS                         ->  local
 *   CloudFront + S3 frontend    ->  this server serves ../../frontend
 *   API Gateway + JWT authorizer->  this server routes /api/* to the api Lambda handler
 *   Cognito                     ->  local sign-in (role chosen on the login page)
 *   RDS PostgreSQL              ->  PostgreSQL 16 in Docker (docker compose up -d)
 *   SQS queues + worker Lambdas ->  in-process queue calling the same worker handlers
 *   S3 uploads (presigned POST) ->  files saved in local-data/uploads
 *   SES email                   ->  text files in local-data/outbox
 *   EventBridge (1 min)         ->  setInterval calling the marking worker
 *
 * Start:  cd backend && npm run local      then open http://localhost:3000
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, 'local-data');
const defaults = {
  DB_HOST: 'localhost', DB_PORT: '55432', DB_USER: 'exam', DB_PASSWORD: 'exam', DB_NAME: 'exams',
  MARKING_QUEUE_URL: 'local://marking', NOTIFY_QUEUE_URL: 'local://notify',
  LOCAL_STORAGE_DIR: path.join(DATA, 'uploads'), LOCAL_OUTBOX_DIR: path.join(DATA, 'outbox'),
  SENDER_EMAIL: 'noreply@exam-platform.local', AWS_REGION: 'us-east-1',
};
for (const [k, v] of Object.entries(defaults)) process.env[k] ||= v;

const api = require('../src/handlers/api');
const marking = require('../src/handlers/markingWorker');
const migrate = require('../src/handlers/migrate');
const queue = require('../src/lib/queue');

const PORT = Number(process.env.PORT || 3000);
const FRONTEND = path.join(ROOT, 'frontend');
const UPLOADS = process.env.LOCAL_STORAGE_DIR;
const MAX_UPLOAD = 50 * 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf', '.zip': 'application/zip' };

// Same route keys as infra/api.tf
const ROUTES = Object.keys(api.routes).map((key) => {
  const [method, pattern] = key.split(' ');
  const names = [];
  const regex = new RegExp(`^${pattern.replace(/\{(\w+)\}/g, (_, n) => { names.push(n); return '([^/]+)'; })}$`);
  return { key, method, regex, names };
});

// ---------- local "Cognito": token = base64url(JSON claims) ----------
const localUsers = new Map(); // email -> group (for the admin page)
function claimsFromRequest(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const c = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (!c.email || !Array.isArray(c['cognito:groups'])) return null;
    c.sub = `local-${crypto.createHash('sha1').update(c.email.toLowerCase()).digest('hex').slice(0, 16)}`;
    localUsers.set(c.email.toLowerCase(), c['cognito:groups'][0]);
    return c;
  } catch { return null; }
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'content-type': isJson ? 'application/json' : 'text/plain', ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------- /api/* -> api Lambda handler (API Gateway HTTP API v2 event) ----------
async function handleApi(req, res, url) {
  if (url.pathname.startsWith('/api/admin/users')) return handleLocalAdmin(req, res);
  const route = ROUTES.find((r) => r.method === req.method && r.regex.test(url.pathname));
  if (!route) return send(res, 404, { message: `No route for ${req.method} ${url.pathname}` });
  const claims = claimsFromRequest(req);
  if (route.key !== 'GET /api/health' && !claims) return send(res, 401, { message: 'Unauthorized' });
  const match = url.pathname.match(route.regex);
  const body = (await readBody(req, 1024 * 1024)).toString('utf8');
  const event = {
    routeKey: route.key,
    rawPath: url.pathname,
    pathParameters: Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(match[i + 1])])),
    body: body || undefined,
    isBase64Encoded: false,
    requestContext: { authorizer: { jwt: { claims: claims || {} } } },
  };
  const started = Date.now();
  const result = await api.handler(event);
  console.log(`${req.method} ${url.pathname} -> ${result.statusCode} (${Date.now() - started} ms)`);
  res.writeHead(result.statusCode, result.headers);
  res.end(result.body);
}

// Local replacement for the admin Lambda (which calls Cognito on AWS)
async function handleLocalAdmin(req, res) {
  const claims = claimsFromRequest(req);
  if (!claims?.['cognito:groups'].includes('admins')) return send(res, 403, { message: 'Requires role: admins' });
  if (req.method === 'POST') {
    const { email, group } = JSON.parse((await readBody(req, 10000)).toString() || '{}');
    if (!email || !['students', 'tutors', 'admins'].includes(group)) return send(res, 400, { message: 'email and valid group required' });
    localUsers.set(email.toLowerCase(), group);
    console.log(`[local cognito] created ${email} in ${group} (sign in locally by choosing this role)`);
    return send(res, 201, { created: email, group });
  }
  const out = { students: [], tutors: [], admins: [] };
  for (const [email, group] of localUsers) out[group]?.push({ email, status: 'LOCAL', enabled: true });
  return send(res, 200, out);
}

// ---------- local "S3": presigned POST target + downloads ----------
async function handleUpload(req, res) {
  const raw = await readBody(req, MAX_UPLOAD + 1024 * 1024);
  const form = await new Request('http://local/upload', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: raw }).formData();
  const key = form.get('key');
  const file = form.get('file');
  if (!key || !file || !key.startsWith('assignments/') || key.includes('..')) return send(res, 400, 'Bad upload');
  if (file.size > MAX_UPLOAD) return send(res, 400, 'EntityTooLarge: max 50 MB'); // same rule as the S3 policy
  const dest = path.join(UPLOADS, key);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await file.arrayBuffer()));
  const meta = {};
  for (const [k, v] of form.entries()) if (k.startsWith('x-amz-meta-')) meta[k.slice(11)] = v;
  meta['content-type'] = form.get('Content-Type');
  fs.writeFileSync(`${dest}.meta.json`, JSON.stringify(meta));
  console.log(`[local s3] stored ${key} (${(file.size / 1048576).toFixed(1)} MB) -> S3 event to uploads queue`);
  // Same shape as an S3 ObjectCreated notification delivered through SQS
  await queue.send('local://uploads', {
    Records: [{ eventName: 'ObjectCreated:Post', s3: { bucket: { name: 'local-uploads' }, object: { key: key.split('/').map(encodeURIComponent).join('/'), size: file.size } } }],
  });
  res.writeHead(204);
  res.end();
}

function serveFile(res, file, extraHeaders = {}) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', ...extraHeaders });
  fs.createReadStream(file).pipe(res);
}

function safeJoin(base, rel) {
  const p = path.resolve(base, rel);
  return p.startsWith(path.resolve(base) + path.sep) ? p : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname === '/local-s3/upload' && req.method === 'POST') return await handleUpload(req, res);
    if (url.pathname.startsWith('/local-s3/files/')) {
      const file = safeJoin(UPLOADS, decodeURIComponent(url.pathname.slice('/local-s3/files/'.length)));
      return file ? serveFile(res, file, { 'content-disposition': `attachment; filename="${path.basename(file)}"` }) : send(res, 400, 'Bad path');
    }
    if (url.pathname === '/config.js') {
      return send(res, 200, `window.APP_CONFIG = ${JSON.stringify({ localMode: true, apiBase: '/api', region: 'local' })};`, { 'content-type': 'application/javascript' });
    }
    const file = safeJoin(FRONTEND, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    return file ? serveFile(res, file) : send(res, 400, 'Bad path');
  } catch (err) {
    console.error(err);
    send(res, err.status || 500, { message: err.message });
  }
});

(async () => {
  console.log('Connecting to PostgreSQL and applying schema.sql ...');
  const result = await migrate.handler();
  console.log(`Database ready. Tables: ${result.tables.join(', ')}`);
  // EventBridge equivalent: auto-submit expired attempts every minute
  setInterval(() => marking.handler({ source: 'aws.events' }).catch((e) => console.error('[auto-submit]', e.message)), 60000);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`
Port ${PORT} is already in use – the app is probably already running in another terminal.`);
      console.error(`Stop that one (Ctrl+C), or use another port:  $env:PORT=3100; npm run local   (PowerShell)
`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(PORT, () => {
    console.log(`\nExam platform running locally: http://localhost:${PORT}`);
    console.log(`Uploaded files: ${UPLOADS}`);
    console.log(`Emails (SES):   ${process.env.LOCAL_OUTBOX_DIR}\n`);
  });
})().catch((err) => {
  console.error('\nCould not start. Is the database running?  ->  docker compose up -d\n', err.message);
  process.exit(1);
});
