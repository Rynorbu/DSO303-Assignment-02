'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validateQuestions, publicQuestions, markMcq } = require('../src/lib/marking');
const { getUser, requireRole } = require('../src/lib/http');
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
  assert.throws(() => validateQuestions([{ ...questions[0], answer: 'EBS' }]), /answer must be one of/);
});

test('strips correct answers before sending to students', () => {
  const pub = publicQuestions(questions);
  assert.ok(pub.every((q) => !('answer' in q)));
  assert.strictEqual(pub.length, 3);
});

test('auto-marks MCQs and flags short answers for manual marking', () => {
  const r = markMcq(questions, { q1: 'S3', q2: 'S3', q3: 'text' });
  assert.deepStrictEqual(r, { mcqScore: 2, maxScore: 10, needsManualMarking: true });
});

test('reads Cognito groups from HTTP API string claim', () => {
  const user = getUser({ requestContext: { authorizer: { jwt: { claims: { sub: 'u1', 'cognito:groups': '[students]' } } } } });
  assert.deepStrictEqual(user.groups, ['students']);
  assert.throws(() => requireRole(user, 'tutors'), /Requires role/);
});

test('parses upload object keys', () => {
  assert.deepStrictEqual(parseKey('assignments/a1/s1/1700000000000-abcd1234-my-report.pdf'),
    { assignmentId: 'a1', studentSub: 's1', fileName: 'my-report.pdf' });
  assert.strictEqual(parseKey('other/key.pdf'), null);
});
