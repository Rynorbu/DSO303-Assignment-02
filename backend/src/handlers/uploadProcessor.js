'use strict';
// Walkthrough 2, step 3: S3 "ObjectCreated" event -> SQS uploads queue -> this Lambda (in the VPC).
// Records the submission in PostgreSQL and queues an email to the tutor.
const db = require('../lib/db');
const queue = require('../lib/queue');
const storage = require('../lib/storage');

// Key format: assignments/{assignmentId}/{studentSub}/{timestamp}-{rand}-{fileName}
function parseKey(key) {
  const parts = key.split('/');
  if (parts.length !== 4 || parts[0] !== 'assignments') return null;
  return { assignmentId: parts[1], studentSub: parts[2], fileName: parts[3].split('-').slice(2).join('-') };
}

async function processS3Record(s3rec) {
  const key = decodeURIComponent(s3rec.s3.object.key.replace(/\+/g, ' '));
  const size = s3rec.s3.object.size;
  const parsed = parseKey(key);
  if (!parsed) { console.warn('Ignoring unexpected key', key); return; }
  // Student email was stored as object metadata by the presigned POST (via the free S3 gateway endpoint).
  const metadata = await storage.headMetadata(s3rec.s3.bucket.name, key);
  const studentEmail = metadata['student-email'] || null;

  const { rows } = await db.query(
    `WITH ins AS (
       INSERT INTO submissions (assignment_id, student_sub, s3_key, size_bytes, student_email)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (s3_key) DO NOTHING RETURNING id)
     SELECT s.title, s.tutor_email, (SELECT id FROM ins) AS submission_id
       FROM assignments s WHERE s.id = $1`,
    [parsed.assignmentId, parsed.studentSub, key, size, studentEmail]);
  const a = rows[0];
  if (!a || !a.submission_id || !a.tutor_email) return; // duplicate event or no tutor email

  await queue.send(process.env.NOTIFY_QUEUE_URL, {
    to: a.tutor_email,
    subject: `New submission: ${a.title}`,
    text: `${studentEmail || 'A student'} submitted "${parsed.fileName}" (${(size / 1048576).toFixed(1)} MB) for "${a.title}". ` +
          `Sign in to the exam platform to download it.`,
  });
  console.log(JSON.stringify({ event: 'submission_recorded', key, size }));
}

exports.handler = async (event) => {
  const batchItemFailures = [];
  for (const record of event.Records || []) {
    try {
      const body = JSON.parse(record.body);
      for (const s3rec of body.Records || []) await processS3Record(s3rec); // s3:TestEvent has no Records
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', messageId: record.messageId, message: err.message }));
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
};

exports.parseKey = parseKey;
