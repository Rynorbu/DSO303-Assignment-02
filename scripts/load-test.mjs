#!/usr/bin/env node
// Small peak-load simulation: signs in as a test student, starts an exam, then fires
// many concurrent autosave requests (the same traffic shape as 3,000 students autosaving
// every 30 s = ~100 req/s). Prints status counts and latency percentiles.
//
// Usage: node scripts/load-test.mjs <app_url> <user_pool_client_id> <region> <student_email> <password> <exam_id> [requests=1000] [concurrency=100]
const [appUrl, clientId, region, email, password, examId, total = '1000', conc = '100'] = process.argv.slice(2);
if (!examId) {
  console.error('Usage: node scripts/load-test.mjs <app_url> <client_id> <region> <email> <password> <exam_id> [requests] [concurrency]');
  process.exit(1);
}

const auth = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
  body: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: email, PASSWORD: password } }),
}).then((r) => r.json());
const token = auth.AuthenticationResult?.IdToken;
if (!token) { console.error('Sign-in failed', auth); process.exit(1); }
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const start = await fetch(`${appUrl}/api/exams/${examId}/start`, { method: 'POST', headers }).then((r) => r.json());
if (!start.attemptId) { console.error('Could not start exam', start); process.exit(1); }
console.log(`Attempt ${start.attemptId}: sending ${total} autosaves with concurrency ${conc}`);

const latencies = [];
const statuses = {};
let sent = 0;
async function worker() {
  while (sent < Number(total)) {
    sent++;
    const t0 = performance.now();
    const res = await fetch(`${appUrl}/api/attempts/${start.attemptId}/answers`, {
      method: 'PUT', headers, body: JSON.stringify({ answers: { q1: 'Amazon S3', q3: `load test ${sent}` } }),
    }).catch(() => ({ status: 'network-error' }));
    latencies.push(performance.now() - t0);
    statuses[res.status] = (statuses[res.status] || 0) + 1;
  }
}
const t0 = performance.now();
await Promise.all(Array.from({ length: Number(conc) }, worker));
const secs = (performance.now() - t0) / 1000;
latencies.sort((a, b) => a - b);
const p = (q) => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))].toFixed(0);
console.log({ requests: latencies.length, seconds: secs.toFixed(1), rps: (latencies.length / secs).toFixed(1), statuses, p50_ms: p(0.5), p95_ms: p(0.95), p99_ms: p(0.99) });
