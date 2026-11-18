'use strict';
// Main API Lambda (runs in the private subnets of the VPC).
// Called by API Gateway HTTP API through CloudFront at /api/*.
const crypto = require('node:crypto');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const db = require('../lib/db');
const { HttpError, json, parseBody, getUser, requireRole } = require('../lib/http');
const { validateQuestions, publicQuestions } = require('../lib/marking');

const sqs = new SQSClient({});
const s3 = new S3Client({});
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED_UPLOADS = { pdf: 'application/pdf', zip: 'application/zip' };
const AUTOSAVE_GRACE_SECONDS = 30;

const routes = {
  'GET /api/health': async () => {
    await db.query('SELECT 1');
    return json(200, { status: 'ok', time: new Date().toISOString() });
  },

  // ---------- Exams ----------
  'GET /api/exams': async (user) => {
    if (user.groups.includes('admins')) {
      const { rows } = await db.query(
        `SELECT id, title, tutor_email, duration_minutes, opens_at, closes_at, results_released
           FROM exams ORDER BY created_at DESC LIMIT 200`);
      return json(200, rows);
    }
    if (user.groups.includes('tutors')) {
      const { rows } = await db.query(
        `SELECT e.id, e.title, e.duration_minutes, e.opens_at, e.closes_at, e.results_released,
                (SELECT count(*) FROM attempts a WHERE a.exam_id = e.id)::int AS attempts
           FROM exams e WHERE e.tutor_sub = $1 ORDER BY e.created_at DESC`, [user.sub]);
      return json(200, rows);
    }
    requireRole(user, 'students');
    const { rows } = await db.query(
      `SELECT e.id, e.title, e.duration_minutes, e.opens_at, e.closes_at,
              a.id AS attempt_id, a.status AS attempt_status, a.deadline
         FROM exams e
         LEFT JOIN attempts a ON a.exam_id = e.id AND a.student_sub = $1
        WHERE (e.opens_at IS NULL OR e.opens_at <= now())
          AND (e.closes_at IS NULL OR e.closes_at > now() - interval '1 day')
        ORDER BY e.opens_at NULLS FIRST`, [user.sub]);
    return json(200, rows);
  },

  'POST /api/exams': async (user, event) => {
    requireRole(user, 'tutors');
    const body = parseBody(event);
    if (!body.title) throw new HttpError(400, 'title is required');
    const duration = Number(body.durationMinutes);
    if (!(duration > 0 && duration <= 480)) throw new HttpError(400, 'durationMinutes must be 1-480');
    try { validateQuestions(body.questions); } catch (e) { throw new HttpError(400, e.message); }
    const { rows } = await db.query(
      `INSERT INTO exams (title, tutor_sub, tutor_email, duration_minutes, opens_at, closes_at, questions)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [body.title, user.sub, user.email, duration, body.opensAt || null, body.closesAt || null, JSON.stringify(body.questions)]);
    return json(201, { id: rows[0].id });
  },

  'PUT /api/exams/{id}/schedule': async (user, event) => {
    requireRole(user, 'admins', 'tutors');
    const body = parseBody(event);
    const isAdmin = user.groups.includes('admins');
    const { rowCount } = await db.query(
      `UPDATE exams SET opens_at = $1, closes_at = $2
        WHERE id = $3 AND ($4 OR tutor_sub = $5)`,
      [body.opensAt || null, body.closesAt || null, event.pathParameters.id, isAdmin, user.sub]);
    if (!rowCount) throw new HttpError(404, 'Exam not found');
    return json(200, { updated: true });
  },

  // Walkthrough 1, step 1: student opens the exam. Idempotent, so a refresh or a
  // reconnect after an AZ failover resumes the same attempt with its saved answers.
  'POST /api/exams/{id}/start': async (user, event) => {
    requireRole(user, 'students');
    const examId = event.pathParameters.id;
    const { rows: exams } = await db.query(
      `SELECT id, title, duration_minutes, opens_at, closes_at, questions FROM exams WHERE id = $1`, [examId]);
    const exam = exams[0];
    if (!exam) throw new HttpError(404, 'Exam not found');
    const now = new Date();
    if (exam.opens_at && now < exam.opens_at) throw new HttpError(403, 'Exam is not open yet');
    if (exam.closes_at && now > exam.closes_at) throw new HttpError(403, 'Exam has closed');

    const { rows } = await db.query(
      `INSERT INTO attempts (exam_id, student_sub, student_email, deadline)
       VALUES ($1, $2, $3, LEAST(now() + make_interval(mins => $4), COALESCE($5, 'infinity'::timestamptz)))
       ON CONFLICT (exam_id, student_sub) DO UPDATE SET exam_id = EXCLUDED.exam_id
       RETURNING id, deadline, answers, status, last_saved_at`,
      [examId, user.sub, user.email, exam.duration_minutes, exam.closes_at]);
    const attempt = rows[0];
    return json(200, {
      attemptId: attempt.id,
      title: exam.title,
      deadline: attempt.deadline,
      serverTime: now.toISOString(),
      status: attempt.status,
      answers: attempt.answers,
      lastSavedAt: attempt.last_saved_at,
      questions: publicQuestions(exam.questions),
    });
  },

  'GET /api/exams/{id}/attempts': async (user, event) => {
    requireRole(user, 'tutors', 'admins');
    const { rows } = await db.query(
      `SELECT a.id, a.student_email, a.status, a.started_at, a.submitted_at, a.answers,
              a.mcq_score, a.manual_score, a.total_score, a.max_score, e.questions
         FROM attempts a JOIN exams e ON e.id = a.exam_id
        WHERE a.exam_id = $1 AND ($2 OR e.tutor_sub = $3)
        ORDER BY a.student_email`,
      [event.pathParameters.id, user.groups.includes('admins'), user.sub]);
    return json(200, rows);
  },

  // Release results -> async fan-out (marking worker queries recipients, notify worker emails them).
  'POST /api/exams/{id}/release': async (user, event) => {
    requireRole(user, 'tutors');
    const examId = event.pathParameters.id;
    const { rowCount } = await db.query(
      `UPDATE exams SET results_released = true WHERE id = $1 AND tutor_sub = $2`, [examId, user.sub]);
    if (!rowCount) throw new HttpError(404, 'Exam not found');
    await sqs.send(new SendMessageCommand({
      QueueUrl: process.env.MARKING_QUEUE_URL,
      MessageBody: JSON.stringify({ type: 'release', examId }),
    }));
    return json(202, { released: true, emails: 'queued' });
  },

  // ---------- Attempts ----------
  // Walkthrough 1, step 2: autosave every 30 seconds.
  'PUT /api/attempts/{id}/answers': async (user, event) => {
    requireRole(user, 'students');
    const body = parseBody(event);
    if (typeof body.answers !== 'object' || body.answers === null) throw new HttpError(400, 'answers object required');
    const { rows } = await db.query(
      `UPDATE attempts SET answers = $1, last_saved_at = now()
        WHERE id = $2 AND student_sub = $3 AND status = 'in_progress'
          AND now() <= deadline + make_interval(secs => $4)
       RETURNING last_saved_at`,
      [JSON.stringify(body.answers), event.pathParameters.id, user.sub, AUTOSAVE_GRACE_SECONDS]);
    if (!rows.length) throw new HttpError(409, 'Attempt is closed or not found');
    return json(200, { savedAt: rows[0].last_saved_at });
  },

  'POST /api/attempts/{id}/submit': async (user, event) => {
    requireRole(user, 'students');
    const body = parseBody(event);
    const { rows } = await db.query(
      `UPDATE attempts
          SET answers = COALESCE($1::jsonb, answers), submitted_at = now(), status = 'submitted',
              last_saved_at = CASE WHEN $1::jsonb IS NULL THEN last_saved_at ELSE now() END
        WHERE id = $2 AND student_sub = $3 AND status = 'in_progress'
          AND now() <= deadline + make_interval(secs => $4)
       RETURNING id`,
      [body.answers ? JSON.stringify(body.answers) : null, event.pathParameters.id, user.sub, AUTOSAVE_GRACE_SECONDS]);
    if (!rows.length) throw new HttpError(409, 'Attempt is closed or not found');
    await sqs.send(new SendMessageCommand({
      QueueUrl: process.env.MARKING_QUEUE_URL,
      MessageBody: JSON.stringify({ type: 'mark', attemptId: rows[0].id }),
    }));
    return json(202, { submitted: true, marking: 'queued' });
  },

  'POST /api/attempts/{id}/mark': async (user, event) => {
    requireRole(user, 'tutors');
    const manual = Number(parseBody(event).manualScore);
    if (!(manual >= 0)) throw new HttpError(400, 'manualScore must be >= 0');
    const { rows } = await db.query(
      `UPDATE attempts a
          SET manual_score = $1, total_score = COALESCE(a.mcq_score, 0) + $1, status = 'marked'
         FROM exams e
        WHERE a.id = $2 AND e.id = a.exam_id AND e.tutor_sub = $3 AND a.status <> 'in_progress'
       RETURNING a.total_score`,
      [manual, event.pathParameters.id, user.sub]);
    if (!rows.length) throw new HttpError(404, 'Attempt not found or not submitted');
    return json(200, { totalScore: rows[0].total_score });
  },

  'GET /api/results': async (user) => {
    requireRole(user, 'students');
    const { rows } = await db.query(
      `SELECT e.title, a.total_score, a.max_score, a.status, a.submitted_at
         FROM attempts a JOIN exams e ON e.id = a.exam_id
        WHERE a.student_sub = $1 AND e.results_released ORDER BY a.submitted_at DESC`, [user.sub]);
    return json(200, rows);
  },

  // ---------- Assignments ----------
  'GET /api/assignments': async (user) => {
    const tutorView = user.groups.includes('tutors');
    const { rows } = await db.query(
      `SELECT s.id, s.title, s.due_at, s.tutor_email,
              (SELECT count(*) FROM submissions x WHERE x.assignment_id = s.id)::int AS submissions,
              (SELECT max(submitted_at) FROM submissions x WHERE x.assignment_id = s.id AND x.student_sub = $1) AS my_last_submission
         FROM assignments s
        WHERE NOT $2 OR s.tutor_sub = $1
        ORDER BY s.due_at NULLS LAST`, [user.sub, tutorView]);
    return json(200, rows);
  },

  'POST /api/assignments': async (user, event) => {
    requireRole(user, 'tutors');
    const body = parseBody(event);
    if (!body.title) throw new HttpError(400, 'title is required');
    const { rows } = await db.query(
      `INSERT INTO assignments (title, tutor_sub, tutor_email, due_at) VALUES ($1,$2,$3,$4) RETURNING id`,
      [body.title, user.sub, user.email, body.dueAt || null]);
    return json(201, { id: rows[0].id });
  },

  // Walkthrough 2, step 1: presigned POST so the 40 MB file goes straight to S3, never through the API.
  'POST /api/assignments/{id}/upload-url': async (user, event) => {
    requireRole(user, 'students');
    const assignmentId = event.pathParameters.id;
    const { fileName } = parseBody(event);
    const ext = String(fileName || '').split('.').pop().toLowerCase();
    const contentType = ALLOWED_UPLOADS[ext];
    if (!contentType) throw new HttpError(400, 'Only .pdf or .zip files are accepted');
    const { rowCount } = await db.query('SELECT 1 FROM assignments WHERE id = $1', [assignmentId]);
    if (!rowCount) throw new HttpError(404, 'Assignment not found');

    const safeName = String(fileName).replace(/[^A-Za-z0-9._-]/g, '_').slice(-100);
    const key = `assignments/${assignmentId}/${user.sub}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
    const post = await createPresignedPost(s3, {
      Bucket: process.env.UPLOADS_BUCKET,
      Key: key,
      Conditions: [
        ['content-length-range', 1, MAX_UPLOAD_BYTES], // S3 itself rejects anything over 50 MB
        ['eq', '$Content-Type', contentType],
        ['eq', '$x-amz-meta-student-email', user.email || ''],
      ],
      Fields: { 'Content-Type': contentType, 'x-amz-meta-student-email': user.email || '' },
      Expires: 900,
    });
    return json(200, { url: post.url, fields: post.fields, key, maxBytes: MAX_UPLOAD_BYTES });
  },

  'GET /api/assignments/{id}/submissions': async (user, event) => {
    requireRole(user, 'tutors');
    const { rows } = await db.query(
      `SELECT x.id, x.student_email, x.s3_key, x.size_bytes, x.submitted_at
         FROM submissions x JOIN assignments s ON s.id = x.assignment_id
        WHERE x.assignment_id = $1 AND s.tutor_sub = $2 ORDER BY x.submitted_at DESC`,
      [event.pathParameters.id, user.sub]);
    for (const r of rows) {
      r.downloadUrl = await getSignedUrl(s3,
        new GetObjectCommand({ Bucket: process.env.UPLOADS_BUCKET, Key: r.s3_key }), { expiresIn: 600 });
    }
    return json(200, rows);
  },
};

exports.handler = async (event) => {
  const route = routes[event.routeKey];
  if (!route) return json(404, { message: `No route for ${event.routeKey}` });
  try {
    return await route(getUser(event), event);
  } catch (err) {
    if (err instanceof HttpError) return json(err.statusCode, { message: err.message });
    console.error(JSON.stringify({ level: 'error', route: event.routeKey, message: err.message, stack: err.stack }));
    return json(500, { message: 'Internal error' });
  }
};

exports.routes = routes; // exported for tests
