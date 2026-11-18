'use strict';
// Sends emails with Amazon SES. Triggered by the SQS notify queue.
// Runs outside the VPC: it needs no database access, only the public SES API.
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const ses = new SESv2Client({});

exports.handler = async (event) => {
  const batchItemFailures = [];
  for (const record of event.Records || []) {
    try {
      const { to, subject, text } = JSON.parse(record.body);
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
