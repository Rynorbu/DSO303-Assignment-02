'use strict';
// Sends emails with Amazon SES. Triggered by the SQS notify queue.
// Runs outside the VPC: it needs no database access, only the public SES API.
// Locally (LOCAL_OUTBOX_DIR set), emails are written to text files instead of being sent.
const fs = require('node:fs');
const path = require('node:path');
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const ses = new SESv2Client({});

function saveToOutbox({ to, subject, text }) {
  const dir = process.env.LOCAL_OUTBOX_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${to.replace(/[^a-z0-9]/gi, '_')}.txt`);
  fs.writeFileSync(file, `From: ${process.env.SENDER_EMAIL}
To: ${to}
Subject: ${subject}

${text}
`);
  console.log(`[local email] to=${to} subject="${subject}" -> ${file}`);
}

exports.handler = async (event) => {
  const batchItemFailures = [];
  for (const record of event.Records || []) {
    try {
      const { to, subject, text } = JSON.parse(record.body);
      if (process.env.LOCAL_OUTBOX_DIR) { saveToOutbox({ to, subject, text }); continue; }
      await ses.send(new SendEmailCommand({
        FromEmailAddress: process.env.SENDER_EMAIL,
        Destination: { ToAddresses: [to] },
        Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
      }));
      console.log(JSON.stringify({ event: 'email_sent', subject }));
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', messageId: record.messageId, message: err.message }));
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
};
