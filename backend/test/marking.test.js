'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  validateQuestions, normaliseQuestions, publicQuestions, totalMarks, markMcq, validateManualMarks, breakdown,
} = require('../src/lib/marking');
const { getUser, requireRole } = require('../src/lib/http');
const v = require('../src/lib/validate');
const { parseKey } = require('../src/handlers/uploadProcessor');

const questions = [
  { id: 'q1', type: 'mcq', text: 'Which service stores files?', options: ['S3', 'SQS'], answer: 'S3', marks: 2 },
  { id: 'q2', type: 'mcq', text: 'Which service queues messages?', options: ['S3', 'SQS'], answer: 'SQS', marks: 2 },
  { id: 'q3', type: 'short', text: 'Explain Multi-AZ.', marks: 6 },
];

test('validates a correct exam', () => {
  assert.strictEqual(validateQuestions(questions), true);
});

test('rejects an MCQ whose answer is not an option', () => {
  assert.throws(() => validateQuestions([{ ...questions[0], answer: 'EBS' }]), /choose the correct option/);
});

test('rejects duplicate or empty options', () => {
  assert.throws(() => validateQuestions([{ ...questions[0], options: ['S3', 'S3'] }]), /must be different/);
  assert.throws(() => validateQuestions([{ ...questions[0], options: ['S3', ' '] }]), /cannot be empty/);
});

test('normalise drops unexpected fields', () => {
  const [q] = normaliseQuestions([{ ...questions[0], evil: '<script>' }]);
  assert.ok(!('evil' in q));
});

test('strips correct answers before sending to students', () => {
  const pub = publicQuestions(questions);
  assert.ok(pub.every((q) => !('answer' in q)));
  assert.strictEqual(pub.length, 3);
  assert.strictEqual(totalMarks(questions), 10);
});

test('auto-marks MCQs and flags short answers for manual marking', () => {
  const r = markMcq(questions, { q1: 'S3', q2: 'S3', q3: 'text' });
  assert.deepStrictEqual(r, { mcqScore: 2, maxScore: 10, needsManualMarking: true });
});

test('validates manual marks per short question', () => {
  assert.deepStrictEqual(validateManualMarks(questions, { q3: 4 }), { marks: { q3: 4 }, manualScore: 4, allMarked: true });
  assert.throws(() => validateManualMarks(questions, { q3: 7 }), /between 0 and 6/);
  assert.throws(() => validateManualMarks(questions, { q1: 1 }), /not a short-answer/);
  assert.strictEqual(validateManualMarks(questions, {}).allMarked, false);
});

test('builds a per-question breakdown', () => {
  const b = breakdown(questions, { q1: 'S3', q2: 'S3', q3: 'standby' }, { q3: 5 });
  assert.deepStrictEqual(b.map((x) => x.awarded), [2, 0, 5]);
  assert.strictEqual(b[1].correctAnswer, 'SQS');
});

test('reads Cognito groups from HTTP API string claim', () => {
  const user = getUser({ requestContext: { authorizer: { jwt: { claims: { sub: 'u1', 'cognito:groups': '[students]' } } } } });
  assert.deepStrictEqual(user.groups, ['students']);
  assert.throws(() => requireRole(user, 'tutors'), /Requires role/);
});

test('input validation helpers', () => {
  assert.throws(() => v.uuid('abc'), /not a valid id/);
  assert.throws(() => v.text('', 'Title', { required: true }), /Title is required/);
  assert.throws(() => v.number(0, 'Duration', { min: 1, max: 480 }), /between 1 and 480/);
  assert.throws(() => v.window('2026-01-02', '2026-01-01'), /after/);
  assert.strictEqual(v.date('', 'x'), null);
});

test('parses upload object keys', () => {
  assert.deepStrictEqual(parseKey('assignments/a1/s1/1700000000000-abcd1234-my-report.pdf'),
    { assignmentId: 'a1', studentSub: 's1', fileName: 'my-report.pdf' });
  assert.strictEqual(parseKey('other/key.pdf'), null);
});
