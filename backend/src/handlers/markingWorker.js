'use strict';
// Async worker in the VPC. Triggered by:
//  - the SQS marking queue: {type:'mark', attemptId} or {type:'release', examId}
//  - an EventBridge schedule every minute: auto-submits attempts whose time ran out
const db = require('../lib/db');
const queue = require('../lib/queue');
const { markMcq } = require('../lib/marking');

async function markAttempt(attemptId) {
  const { rows } = await db.query(
    `SELECT a.id, a.answers, a.status, e.questions
       FROM attempts a JOIN exams e ON e.id = a.exam_id WHERE a.id = $1`, [attemptId]);
  const attempt = rows[0];
  if (!attempt || attempt.status === 'in_progress') return; // nothing to do (idempotent)
  const { mcqScore, maxScore, needsManualMarking } = markMcq(attempt.questions, attempt.answers);
  await db.query(
    `UPDATE attempts
        SET mcq_score = $1, max_score = $2,
            total_score = $1 + COALESCE(manual_score, 0),
            status = CASE WHEN status = 'marked' THEN 'marked'
                          WHEN $3 THEN 'awaiting_manual' ELSE 'marked' END
      WHERE id = $4`,
    [mcqScore, maxScore, needsManualMarking, attemptId]);
  console.log(JSON.stringify({ event: 'marked', attemptId, mcqScore, maxScore }));
}

async function fanOutResultEmails(examId) {
  const { rows } = await db.query(
    `SELECT a.student_email, a.total_score, a.max_score, a.status, e.title
       FROM attempts a JOIN exams e ON e.id = a.exam_id
      WHERE a.exam_id = $1 AND e.results_released AND a.student_email IS NOT NULL`, [examId]);
  await queue.sendBatch(process.env.NOTIFY_QUEUE_URL, rows.map((r) => ({
    to: r.student_email,
    subject: `Results released: ${r.title}`,
    text: r.status === 'marked'
      ? `Your result for "${r.title}" is ${r.total_score} / ${r.max_score}. Sign in to view details.`
      : `Results for "${r.title}" have been released. Sign in to view your result.`,
  })));
  console.log(JSON.stringify({ event: 'results_released', examId, emails: rows.length }));
}

async function autoSubmitExpired() {
  const { rows } = await db.query(
    `UPDATE attempts SET status = 'submitted', submitted_at = deadline
      WHERE status = 'in_progress' AND deadline + interval '30 seconds' < now()
     RETURNING id`);
  for (const r of rows) {
    await queue.send(process.env.MARKING_QUEUE_URL, { type: 'mark', attemptId: r.id });
  }
  if (rows.length) console.log(JSON.stringify({ event: 'auto_submitted', count: rows.length }));
}

exports.handler = async (event) => {
  if (event.source === 'aws.events' || event['detail-type'] === 'Scheduled Event') {
    await autoSubmitExpired();
    return;
  }
  const batchItemFailures = [];
  for (const record of event.Records || []) {
    try {
      const msg = JSON.parse(record.body);
      if (msg.type === 'mark') await markAttempt(msg.attemptId);
      else if (msg.type === 'release') await fanOutResultEmails(msg.examId);
      else console.warn('Unknown message type', msg.type);
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', messageId: record.messageId, message: err.message }));
      batchItemFailures.push({ itemIdentifier: record.messageId }); // retried, then sent to the DLQ
    }
  }
  return { batchItemFailures };
};
