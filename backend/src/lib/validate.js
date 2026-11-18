'use strict';
// Small input-validation helpers. All throw HttpError(400) with a clear message.
const { HttpError } = require('./http');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(value, name = 'id') {
  if (!UUID.test(String(value || ''))) throw new HttpError(400, `${name} is not a valid id`);
  return value;
}

function text(value, name, { required = false, max = 200 } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) throw new HttpError(400, `${name} is required`);
    return null;
  }
  const s = String(value).trim();
  if (s.length > max) throw new HttpError(400, `${name} must be at most ${max} characters`);
  return s;
}

function date(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${name} is not a valid date`);
  return d.toISOString();
}

function window(opensAt, closesAt) {
  if (opensAt && closesAt && new Date(closesAt) <= new Date(opensAt)) {
    throw new HttpError(400, 'closesAt must be after opensAt');
  }
}

function number(value, name, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new HttpError(400, `${name} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}`);
  }
  return n;
}

module.exports = { uuid, text, date, window, number };
