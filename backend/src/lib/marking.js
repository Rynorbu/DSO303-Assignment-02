'use strict';
// Pure functions so they can be unit-tested without AWS.

const ALLOWED_TYPES = ['mcq', 'short'];
const MAX_QUESTIONS = 200;

function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('Add at least one question');
  }
  if (questions.length > MAX_QUESTIONS) throw new Error(`An exam can have at most ${MAX_QUESTIONS} questions`);
  const ids = new Set();
  questions.forEach((q, i) => {
    const label = `Question ${i + 1}`;
    if (!q || typeof q !== 'object') throw new Error(`${label} is invalid`);
    if (!q.id || typeof q.id !== 'string' || ids.has(q.id)) throw new Error(`${label} needs a unique id`);
    ids.add(q.id);
    if (!ALLOWED_TYPES.includes(q.type)) throw new Error(`${label}: type must be mcq or short`);
    if (!q.text || !String(q.text).trim()) throw new Error(`${label}: question text is required`);
    if (String(q.text).length > 5000) throw new Error(`${label}: question text is too long`);
    if (!(Number(q.marks) > 0) || Number(q.marks) > 100) throw new Error(`${label}: marks must be between 1 and 100`);
    if (q.type === 'mcq') {
      if (!Array.isArray(q.options) || q.options.length < 2) throw new Error(`${label}: add at least 2 options`);
      if (q.options.length > 10) throw new Error(`${label}: at most 10 options`);
      if (q.options.some((o) => !String(o ?? '').trim())) throw new Error(`${label}: options cannot be empty`);
      if (new Set(q.options).size !== q.options.length) throw new Error(`${label}: options must be different`);
      if (!q.options.includes(q.answer)) throw new Error(`${label}: choose the correct option`);
    }
  });
  return true;
}

// Keeps only the fields we store (drops anything unexpected sent by the client).
function normaliseQuestions(questions) {
  return questions.map((q) => (q.type === 'mcq'
    ? { id: q.id, type: 'mcq', text: String(q.text).trim(), options: q.options.map((o) => String(o).trim()), answer: String(q.answer).trim(), marks: Number(q.marks) }
    : { id: q.id, type: 'short', text: String(q.text).trim(), marks: Number(q.marks) }));
}

// Removes correct answers before questions are sent to a student.
function publicQuestions(questions) {
  return questions.map(({ answer, ...rest }) => rest);
}

function totalMarks(questions) {
  return questions.reduce((sum, q) => sum + Number(q.marks), 0);
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

// Validates tutor marks for short-answer questions and returns their sum.
function validateManualMarks(questions, marks) {
  if (!marks || typeof marks !== 'object') throw new Error('marks object required');
  let sum = 0;
  const clean = {};
  for (const [qid, value] of Object.entries(marks)) {
    const q = questions.find((x) => x.id === qid);
    if (!q || q.type !== 'short') throw new Error(`${qid} is not a short-answer question`);
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > Number(q.marks)) throw new Error(`Mark for ${qid} must be between 0 and ${q.marks}`);
    clean[qid] = n;
    sum += n;
  }
  const allMarked = questions.filter((q) => q.type === 'short').every((q) => clean[q.id] !== undefined);
  return { marks: clean, manualScore: sum, allMarked };
}

// Per-question breakdown shown to students after results are released.
function breakdown(questions, answers = {}, manualMarks = {}) {
  return questions.map((q) => {
    const given = answers[q.id] ?? null;
    if (q.type === 'mcq') {
      const correct = given === q.answer;
      return { id: q.id, type: q.type, text: q.text, options: q.options, answer: given, correctAnswer: q.answer, correct, awarded: correct ? Number(q.marks) : 0, marks: Number(q.marks) };
    }
    return { id: q.id, type: q.type, text: q.text, answer: given, awarded: manualMarks[q.id] ?? null, marks: Number(q.marks) };
  });
}

module.exports = { validateQuestions, normaliseQuestions, publicQuestions, totalMarks, markMcq, validateManualMarks, breakdown };
