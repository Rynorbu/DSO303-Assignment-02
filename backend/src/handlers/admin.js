'use strict';
// Admin user management (Cognito). Runs outside the VPC because it only calls the Cognito API.
const {
  CognitoIdentityProviderClient, AdminCreateUserCommand, AdminAddUserToGroupCommand,
  ListUsersInGroupCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { HttpError, json, parseBody, getUser, requireRole } = require('../lib/http');

const cognito = new CognitoIdentityProviderClient({});
const GROUPS = ['students', 'tutors', 'admins'];

const routes = {
  'POST /api/admin/users': async (event) => {
    const { email, group } = parseBody(event);
    if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new HttpError(400, 'valid email required');
    if (!GROUPS.includes(group)) throw new HttpError(400, `group must be one of ${GROUPS.join(', ')}`);
    await cognito.send(new AdminCreateUserCommand({
      UserPoolId: process.env.USER_POOL_ID,
      Username: email,
      UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }],
      DesiredDeliveryMediums: ['EMAIL'], // Cognito emails a temporary password
    }));
    await cognito.send(new AdminAddUserToGroupCommand({
      UserPoolId: process.env.USER_POOL_ID, Username: email, GroupName: group,
    }));
    return json(201, { created: email, group });
  },

  'GET /api/admin/users': async () => {
    const result = {};
    for (const g of GROUPS) {
      const res = await cognito.send(new ListUsersInGroupCommand({
        UserPoolId: process.env.USER_POOL_ID, GroupName: g, Limit: 60,
      }));
      result[g] = res.Users.map((u) => ({
        email: u.Attributes.find((a) => a.Name === 'email')?.Value,
        status: u.UserStatus,
        enabled: u.Enabled,
      }));
    }
    return json(200, result);
  },
};

exports.handler = async (event) => {
  try {
    requireRole(getUser(event), 'admins');
    const route = routes[event.routeKey];
    if (!route) return json(404, { message: 'Not found' });
    return await route(event);
  } catch (err) {
    if (err instanceof HttpError) return json(err.statusCode, { message: err.message });
    if (err.name === 'UsernameExistsException') return json(409, { message: 'User already exists' });
    console.error(JSON.stringify({ level: 'error', message: err.message }));
    return json(500, { message: 'Internal error' });
  }
};
