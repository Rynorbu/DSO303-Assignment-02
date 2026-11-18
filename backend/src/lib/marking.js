'use strict';
// Pure functions so they can be unit-tested without AWS.

const ALLOWED_TYPES = ['mcq', 'short'];

function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('questions must be a non-empty array');
  }
  const ids = new Set();
  for (const q of questions) {
    if (!q.id || ids.has(q.id)) throw new Error('each question needs a unique id');
    ids.add(q.id);
    if (!ALLOWED_TYPES.includes(q.type)) throw new Error(`question ${q.id}: type must be mcq or short`);
    if (!q.text) throw new Error(`question ${q.id}: text is required`);
    if (!(Number(q.marks) > 0)) throw new Error(`question ${q.id}: marks must be > 0`);
    if (q.type === 'mcq') {
      if (!Array.isArray(q.options) || q.options.length < 2) throw new Error(`question ${q.id}: mcq needs >= 2 options`);
      if (!q.options.includes(q.answer)) throw new Error(`question ${q.id}: answer must be one of the options`);
    }
  }
  return true;
}

// Removes correct answers before questions are sent to a student.
function publicQuestions(questions) {
  return questions.map(({ answer, ...rest }) => rest);
}

function markMcq(questions, answers = {}) {
  let mcqScore = 0;
  let maxScore = 0;
  let hasShort = false;
  for (const q of questions) {
    maxScore += Number(q.marks);
    if (q.type === 'mcq') {
      if (answers[q.id] !== undefined && answers[q.id] === q.answer) mcqScore += Number(q.marks);
    } else {
      hasShort = true;
    }
  }
  return { mcqScore, maxScore, needsManualMarking: hasShort };
}

module.exports = { validateQuestions, publicQuestions, markMcq };
