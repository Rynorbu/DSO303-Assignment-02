'use strict';
// Sends messages to SQS on AWS. When the queue URL starts with "local://" (local development),
// the message is delivered in-process to the same worker Lambda handler, shaped like an SQS event.
const crypto = require('node:crypto');
const { SQSClient, SendMessageCommand, SendMessageBatchCommand } = require('@aws-sdk/client-sqs');

let sqs;
const client = () => (sqs ||= new SQSClient({}));

const LOCAL_WORKERS = {
  marking: () => require('../handlers/markingWorker'),
  notify: () => require('../handlers/notifyWorker'),
  uploads: () => require('../handlers/uploadProcessor'),
};

function deliverLocally(queueUrl, bodies) {
  const name = queueUrl.replace('local://', '');
  const worker = LOCAL_WORKERS[name];
  if (!worker) throw new Error(`Unknown local queue ${queueUrl}`);
  const event = { Records: bodies.map((body) => ({ messageId: crypto.randomUUID(), body })) };
  // Asynchronous, like a real queue: the caller does not wait for the worker.
  setImmediate(async () => {
    try {
      const res = await worker().handler(event);
      if (res?.batchItemFailures?.length) console.error(`[local queue ${name}] ${res.batchItemFailures.length} message(s) failed`);
    } catch (err) {
      console.error(`[local queue ${name}]`, err);
    }
  });
}

async function send(queueUrl, message) {
  const body = JSON.stringify(message);
  if (queueUrl.startsWith('local://')) return deliverLocally(queueUrl, [body]);
  await client().send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }));
}

// Sends up to any number of messages in SQS batches of 10.
async function sendBatch(queueUrl, messages) {
  for (let i = 0; i < messages.length; i += 10) {
    const chunk = messages.slice(i, i + 10).map((m) => JSON.stringify(m));
    if (queueUrl.startsWith('local://')) { deliverLocally(queueUrl, chunk); continue; }
    const res = await client().send(new SendMessageBatchCommand({
      QueueUrl: queueUrl,
      Entries: chunk.map((body, j) => ({ Id: String(i + j), MessageBody: body })),
    }));
    if (res.Failed?.length) throw new Error(`Failed to queue ${res.Failed.length} message(s)`);
  }
}

module.exports = { send, sendBatch };
