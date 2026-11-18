'use strict';

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
}

// Reads the caller from the Cognito ID token claims that API Gateway's JWT authorizer already verified.
function getUser(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  let groups = claims['cognito:groups'] || [];
  if (typeof groups === 'string') {
    // HTTP API passes array claims as "[a b]" strings
    groups = groups.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
  }
  return { sub: claims.sub, email: claims.email, groups };
}

function requireRole(user, ...roles) {
  if (!roles.some((r) => user.groups.includes(r))) {
    throw new HttpError(403, `Requires role: ${roles.join(' or ')}`);
  }
}

module.exports = { HttpError, json, parseBody, getUser, requireRole };
