'use strict';
// Main API Lambda (runs in the private subnets of the VPC).
// Called by API Gateway HTTP API through CloudFront at /api/*.
const crypto = require('node:crypto');
const db = require('../lib/db');
const queue = require('../lib/queue');
const storage = require('../lib/storage');
const v = require('../lib/validate');
const { HttpError, json, parseBody, getUser, requireRole } = require('../lib/http');
const {
  validateQuestions, normaliseQuestions, publicQuestions, totalMarks, validateManualMarks, breakdown,
} = require('../lib/marking');

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_ANSWERS_BYTES = 256 * 1024; // generous: about 40,000 words of short answers
const ALLOWED_UPLOADS = { pdf: 'application/pdf', zip: 'application/zip' };
const AUTOSAVE_GRACE_SECONDS = 30;

const isAdmin = (user) => user.groups.includes('admins');
const isTutor = (user) => user.groups.includes('tutors');

// Aggregate columns reused by tutor/admin exam lists
const EXAM_STATS = `
  jsonb_array_length(e.questions) AS question_count,
  (SELECT COALESCE(sum((q->>'marks')::numeric), 0) FROM jsonb_array_elements(e.questions) q) AS total_marks,
  (SELECT count(*) FROM attempts a WHERE a.exam_id = e.id)::int AS attempts,
  (SELECT count(*) FROM attempts a WHERE a.exam_id = e.id AND a.status <> 'in_progress')::int AS submitted,
  (SELECT count(*) FROM attempts a WHERE a.exam_id = e.id AND a.status = 'awaiting_manual')::int AS awaiting_marking,
  (SELECT round(avg(a.total_score / NULLIF(a.max_score, 0)) * 100, 1) FROM attempts a WHERE a.exam_id = e.id AND a.status = 'marked') AS average_percent`;

function validateAnswers(answers) {
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) throw new HttpError(400, 'answers object required');
  if (Buffer.byteLength(JSON.stringify(answers)) > MAX_ANSWERS_BYTES) throw new HttpError(413, 'Answers are too large');
  return answers;
}

async function loadOwnedExam(user, examId) {
  const { rows } = await db.query(`SELECT * FROM exams WHERE id = $1`, [v.uuid(examId, 'exam id')]);
  const exam = rows[0];
  if (!exam || (!isAdmin(user) && exam.tutor_sub !== user.sub)) throw new HttpError(404, 'Exam not found');
  return exam;
}

const routes = {
  'GET /api/health': async () => {
    await db.query('SELECT 1');
    return json(200, { status: 'ok', time: new Date().toISOString() });
  },

  // ---------------------------------------------------------------- Exams
  'GET /api/exams': async (user) => {
    if (isAdmin(user)) {
      const { rows } = await db.query(
        `SELECT e.id, e.title, e.description, e.tutor_email, e.duration_minutes, e.opens_at, e.closes_at,
                e.results_released, e.created_at, ${EXAM_STATS}
           FROM exams e ORDER BY e.created_at DESC LIMIT 500`);
      return json(200, rows);
    }
    if (isTutor(user)) {
      const { rows } = await db.query(
        `SELECT e.id, e.title, e.description, e.duration_minutes, e.opens_at, e.closes_at,
                e.results_released, e.created_at, ${EXAM_STATS}
           FROM exams e WHERE e.tutor_sub = $1 ORDER BY e.created_at DESC`, [user.sub]);
      return json(200, rows);
    }
    requireRole(user, 'students');
    const { rows } = await db.query(
      `SELECT e.id, e.title, e.description, e.duration_minutes, e.opens_at, e.closes_at, e.results_released,
              jsonb_array_length(e.questions) AS question_count,
              (SELECT COALESCE(sum((q->>'marks')::numeric), 0) FROM jsonb_array_elements(e.questions) q) AS total_marks,
              a.id AS attempt_id, a.status AS attempt_status, a.deadline, a.submitted_at
         FROM exams e
         LEFT JOIN attempts a ON a.exam_id = e.id AND a.student_sub = $1
        WHERE (e.opens_at IS NULL OR e.opens_at <= now() + interval '14 days')
          AND (e.closes_at IS NULL OR e.closes_at > now() - interval '7 days' OR a.id IS NOT NULL)
        ORDER BY e.opens_at NULLS FIRST, e.created_at DESC`, [user.sub]);
    return json(200, rows);
  },

  'GET /api/exams/{id}': async (user, event) => {
    requireRole(user, 'tutors', 'admins');
    const exam = await loadOwnedExam(user, event.pathParameters.id);
    return json(200, { ...exam, total_marks: totalMarks(exam.questions) });
  },

  'POST /api/exams': async (user, event) => {
    requireRole(user, 'tutors');
    const body = parseBody(event);
    const title = v.text(body.title, 'Title', { required: true, max: 200 });
    const description = v.text(body.description, 'Description', { max: 2000 });
    const duration = v.number(body.durationMinutes, 'Duration (minutes)', { min: 1, max: 480, integer: true });
    const opensAt = v.date(body.opensAt, 'Opens at');
    const closesAt = v.date(body.closesAt, 'Closes at');
    v.window(opensAt, closesAt);
    try { validateQuestions(body.questions); } catch (e) { throw new HttpError(400, e.message); }
    const questions = normaliseQuestions(body.questions);
    const { rows } = await db.query(
      `INSERT INTO exams (title, description, tutor_sub, tutor_email, duration_minutes, opens_at, closes_at, questions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [title, description, user.sub, user.email, duration, opensAt, closesAt, JSON.stringify(questions)]);
    return json(201, { id: rows[0].id });
  },

  'DELETE /api/exams/{id}': async (user, event) => {
    requireRole(user, 'tutors', 'admins');
    const exam = await loadOwnedExam(user, event.pathParameters.id);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM attempts WHERE exam_id = $1', [exam.id]);
    if (rows[0].n > 0) throw new HttpError(409, 'Students have already attempted this exam, so it cannot be deleted (records must be kept)');
    await db.query('DELETE FROM exams WHERE id = $1', [exam.id]);
    return json(200, { deleted: true });
  },

  'PUT /api/exams/{id}/schedule': async (user, event) => {
    requireRole(user, 'admins', 'tutors');
    const body = parseBody(event);
    const opensAt = v.date(body.opensAt, 'Opens at');
    const closesAt = v.date(body.closesAt, 'Closes at');
    v.window(opensAt, closesAt);
    const exam = await loadOwnedExam(user, event.pathParameters.id);
    await db.query('UPDATE exams SET opens_at = $1, closes_at = $2 WHERE id = $3', [opensAt, closesAt, exam.id]);
    return json(200, { updated: true });
  },

  // Walkthrough 1, step 1: student opens the exam. Idempotent, so a refresh or a
  // reconnect after an AZ failover resumes the same attempt with its saved answers.
  'POST /api/exams/{id}/start': async (user, event) => {
    requireRole(user, 'students');
    const examId = v.uuid(event.pathParameters.id, 'exam id');
    const { rows: exams } = await db.query(
      `SELECT id, title, description, duration_minutes, opens_at, closes_at, questions FROM exams WHERE id = $1`, [examId]);
    const exam = exams[0];
    if (!exam) throw new HttpError(404, 'Exam not found');
    const now = new Date();
    const { rows: existing } = await db.query(
      'SELECT id FROM attempts WHERE exam_id = $1 AND student_sub = $2', [examId, user.sub]);
    if (!existing.length) {
      if (exam.opens_at && now < exam.opens_at) throw new HttpError(403, `This exam opens at ${exam.opens_at.toISOString()}`);
      if (exam.closes_at && now > exam.closes_at) throw new HttpError(403, 'This exam has closed');
    }
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
      description: exam.description,
      deadline: attempt.deadline,
      serverTime: now.toISOString(),
      status: attempt.status,
      answers: attempt.answers,
      lastSavedAt: attempt.last_saved_at,
      totalMarks: totalMarks(exam.questions),
      questions: publicQuestions(exam.questions),
    });
  },

  'GET /api/exams/{id}/attempts': async (user, event) => {
    requireRole(user, 'tutors', 'admins');
    const exam = await loadOwnedExam(user, event.pathParameters.id);
    const { rows } = await db.query(
      `SELECT id, student_email, status, started_at, submitted_at, last_saved_at, deadline, answers,
              mcq_score, manual_score, manual_marks, feedback, total_score, max_score
         FROM attempts WHERE exam_id = $1 ORDER BY student_email`, [exam.id]);
    return json(200, { exam: { ...exam, total_marks: totalMarks(exam.questions) }, attempts: rows });
  },

  // Release results -> async fan-out (marking worker queries recipients, notify worker emails them).
  'POST /api/exams/{id}/release': async (user, event) => {
    requireRole(user, 'tutors');
    const exam = await loadOwnedExam(user, event.pathParameters.id);
    if (exam.results_released) throw new HttpError(409, 'Results were already released');
    const { rows } = await db.query(
      `SELECT count(*) FILTER (WHERE status = 'awaiting_manual')::int AS pending,
              count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress
         FROM attempts WHERE exam_id = $1`, [exam.id]);
    if (rows[0].pending > 0) throw new HttpError(409, `${rows[0].pending} attempt(s) still need short answers marked`);
    if (rows[0].in_progress > 0) throw new HttpError(409, `${rows[0].in_progress} student(s) are still sitting the exam`);
    await db.query('UPDATE exams SET results_released = true WHERE id = $1', [exam.id]);
    await queue.send(process.env.MARKING_QUEUE_URL, { type: 'release', examId: exam.id });
    return json(202, { released: true, emails: 'queued' });
  },

  // ---------------------------------------------------------------- Attempts
  // Walkthrough 1, step 2: autosave every 30 seconds.
  'PUT /api/attempts/{id}/answers': async (user, event) => {
    requireRole(user, 'students');
    const answers = validateAnswers(parseBody(event).answers);
    const { rows } = await db.query(
      `UPDATE attempts SET answers = $1, last_saved_at = now()
        WHERE id = $2 AND student_sub = $3 AND status = 'in_progress'
          AND now() <= deadline + make_interval(secs => $4)
       RETURNING last_saved_at`,
      [JSON.stringify(answers), v.uuid(event.pathParameters.id, 'attempt id'), user.sub, AUTOSAVE_GRACE_SECONDS]);
    if (!rows.length) throw new HttpError(409, 'This attempt is closed (time is up or it was already submitted)');
    return json(200, { savedAt: rows[0].last_saved_at });
  },

  'POST /api/attempts/{id}/submit': async (user, event) => {
    requireRole(user, 'students');
    const body = parseBody(event);
    const answers = body.answers === undefined ? null : validateAnswers(body.answers);
    const { rows } = await db.query(
      `UPDATE attempts
          SET answers = COALESCE($1::jsonb, answers), submitted_at = now(), status = 'submitted',
              last_saved_at = CASE WHEN $1::jsonb IS NULL THEN last_saved_at ELSE now() END
        WHERE id = $2 AND student_sub = $3 AND status = 'in_progress'
          AND now() <= deadline + make_interval(secs => $4)
       RETURNING id, submitted_at`,
      [answers ? JSON.stringify(answers) : null, v.uuid(event.pathParameters.id, 'attempt id'), user.sub, AUTOSAVE_GRACE_SECONDS]);
    if (!rows.length) throw new HttpError(409, 'This attempt is closed (time is up or it was already submitted)');
    await queue.send(process.env.MARKING_QUEUE_URL, { type: 'mark', attemptId: rows[0].id });
    return json(202, { submitted: true, submittedAt: rows[0].submitted_at, marking: 'queued' });
  },

  // Tutor marks short answers question by question, with optional feedback.
  'POST /api/attempts/{id}/mark': async (user, event) => {
    requireRole(user, 'tutors');
    const body = parseBody(event);
    const feedback = v.text(body.feedback, 'Feedback', { max: 5000 });
    const { rows } = await db.query(
      `SELECT a.id, a.status, a.mcq_score, e.questions, e.tutor_sub
         FROM attempts a JOIN exams e ON e.id = a.exam_id WHERE a.id = $1`,
      [v.uuid(event.pathParameters.id, 'attempt id')]);
    const attempt = rows[0];
    if (!attempt || attempt.tutor_sub !== user.sub) throw new HttpError(404, 'Attempt not found');
    if (attempt.status === 'in_progress') throw new HttpError(409, 'The student has not submitted yet');
    if (attempt.mcq_score === null) throw new HttpError(409, 'Auto-marking is still running, try again in a moment');
    let result;
    try { result = validateManualMarks(attempt.questions, body.marks || {}); } catch (e) { throw new HttpError(400, e.message); }
    const { rows: updated } = await db.query(
      `UPDATE attempts
          SET manual_marks = $1, manual_score = $2, total_score = mcq_score + $2, feedback = $3,
              status = CASE WHEN $4 THEN 'marked' ELSE 'awaiting_manual' END
        WHERE id = $5
       RETURNING status, total_score, max_score`,
      [JSON.stringify(result.marks), result.manualScore, feedback, result.allMarked, attempt.id]);
    return json(200, { status: updated[0].status, totalScore: updated[0].total_score, maxScore: updated[0].max_score });
  },

  // Student results with a per-question breakdown (only once the tutor releases them).
  'GET /api/results': async (user) => {
    requireRole(user, 'students');
    const { rows } = await db.query(
      `SELECT e.id AS exam_id, e.title, e.questions, a.answers, a.manual_marks, a.feedback,
              a.mcq_score, a.manual_score, a.total_score, a.max_score, a.status, a.submitted_at
         FROM attempts a JOIN exams e ON e.id = a.exam_id
        WHERE a.student_sub = $1 AND e.results_released ORDER BY a.submitted_at DESC NULLS LAST`, [user.sub]);
    return json(200, rows.map(({ questions, answers, manual_marks: mm, ...r }) => ({
      ...r,
      percent: r.max_score > 0 ? Math.round((r.total_score / r.max_score) * 1000) / 10 : null,
      breakdown: breakdown(questions, answers, mm),
    })));
  },

  // ---------------------------------------------------------------- Assignments
  'GET /api/assignments': async (user) => {
    const tutorView = isTutor(user);
    const { rows } = await db.query(
      `SELECT s.id, s.title, s.description, s.due_at, s.tutor_email, s.created_at,
              (SELECT count(*) FROM submissions x WHERE x.assignment_id = s.id)::int AS submissions,
              (SELECT count(DISTINCT x.student_sub) FROM submissions x WHERE x.assignment_id = s.id)::int AS students_submitted,
              (SELECT max(submitted_at) FROM submissions x WHERE x.assignment_id = s.id AND x.student_sub = $1) AS my_last_submission,
              (SELECT x.s3_key FROM submissions x WHERE x.assignment_id = s.id AND x.student_sub = $1
                ORDER BY x.submitted_at DESC LIMIT 1) AS my_last_key,
              (SELECT x.size_bytes FROM submissions x WHERE x.assignment_id = s.id AND x.student_sub = $1
                ORDER BY x.submitted_at DESC LIMIT 1) AS my_last_size
         FROM assignments s
        WHERE NOT $2 OR s.tutor_sub = $1
        ORDER BY s.due_at NULLS LAST, s.created_at DESC`, [user.sub, tutorView]);
    return json(200, rows.map(({ my_last_key: key, ...r }) => ({
      ...r,
      my_last_file: key ? key.split('/').pop().split('-').slice(2).join('-') : null,
    })));
  },

  'POST /api/assignments': async (user, event) => {
    requireRole(user, 'tutors');
    const body = parseBody(event);
    const title = v.text(body.title, 'Title', { required: true, max: 200 });
    const description = v.text(body.description, 'Description', { max: 5000 });
    const dueAt = v.date(body.dueAt, 'Due date');
    const { rows } = await db.query(
      `INSERT INTO assignments (title, description, tutor_sub, tutor_email, due_at) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [title, description, user.sub, user.email, dueAt]);
    return json(201, { id: rows[0].id });
  },

  // Walkthrough 2, step 1: presigned POST so the 40 MB file goes straight to S3, never through the API.
  'POST /api/assignments/{id}/upload-url': async (user, event) => {
    requireRole(user, 'students');
    const assignmentId = v.uuid(event.pathParameters.id, 'assignment id');
    const { fileName, size } = parseBody(event);
    const ext = String(fileName || '').split('.').pop().toLowerCase();
    const contentType = ALLOWED_UPLOADS[ext];
    if (!contentType) throw new HttpError(400, 'Only PDF or ZIP files are accepted');
    if (size !== undefined && Number(size) > MAX_UPLOAD_BYTES) throw new HttpError(400, 'Files must be 50 MB or smaller');
    const { rowCount } = await db.query('SELECT 1 FROM assignments WHERE id = $1', [assignmentId]);
    if (!rowCount) throw new HttpError(404, 'Assignment not found');

    const safeName = String(fileName).replace(/[^A-Za-z0-9._-]/g, '_').slice(-100);
    const key = `assignments/${assignmentId}/${user.sub}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
    const post = await storage.presignUpload({
      key, contentType, maxBytes: MAX_UPLOAD_BYTES, metadata: { 'student-email': user.email || '' },
    });
    return json(200, { url: post.url, fields: post.fields, key, maxBytes: MAX_UPLOAD_BYTES });
  },

  'GET /api/assignments/{id}/submissions': async (user, event) => {
    requireRole(user, 'tutors');
    const assignmentId = v.uuid(event.pathParameters.id, 'assignment id');
    const { rows: owner } = await db.query(
      'SELECT id, title, description, due_at FROM assignments WHERE id = $1 AND tutor_sub = $2', [assignmentId, user.sub]);
    if (!owner.length) throw new HttpError(404, 'Assignment not found');
    const { rows } = await db.query(
      `SELECT id, student_email, s3_key, size_bytes, submitted_at FROM submissions
        WHERE assignment_id = $1 ORDER BY submitted_at DESC`, [assignmentId]);
    const dueAt = owner[0].due_at;
    for (const r of rows) {
      r.file_name = r.s3_key.split('/').pop().split('-').slice(2).join('-');
      r.late = !!(dueAt && r.submitted_at > dueAt);
      r.downloadUrl = await storage.presignDownload(r.s3_key);
      delete r.s3_key;
    }
    return json(200, { assignment: owner[0], submissions: rows });
  },
};

exports.handler = async (event) => {
  const route = routes[event.routeKey];
  if (!route) return json(404, { message: `No route for ${event.routeKey}` });
  try {
    return await route(getUser(event), event);
  } catch (err) {
    if (err instanceof HttpError) return json(err.statusCode, { message: err.message });
    if (err.code === '22P02') return json(400, { message: 'Invalid input' }); // postgres: invalid text representation
    console.error(JSON.stringify({ level: 'error', route: event.routeKey, message: err.message, stack: err.stack }));
    return json(500, { message: 'Something went wrong on our side. Please try again.' });
  }
};

exports.routes = routes; // exported for tests and the local server
