'use strict';
// File storage. On AWS: S3 presigned POST/GET + HeadObject.
// Locally (LOCAL_STORAGE_DIR set): files are saved in a folder by backend/local/server.js,
// which plays the role of S3 using the same "presigned POST" form shape.
const fs = require('node:fs');
const path = require('node:path');
const { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const LOCAL_DIR = process.env.LOCAL_STORAGE_DIR;
let s3;
const client = () => (s3 ||= new S3Client({}));

async function presignUpload({ key, contentType, maxBytes, metadata }) {
  const metaFields = Object.fromEntries(Object.entries(metadata).map(([k, v]) => [`x-amz-meta-${k}`, v]));
  if (LOCAL_DIR) {
    return { url: '/local-s3/upload', fields: { key, 'Content-Type': contentType, ...metaFields } };
  }
  return createPresignedPost(client(), {
    Bucket: process.env.UPLOADS_BUCKET,
    Key: key,
    Conditions: [
      ['content-length-range', 1, maxBytes], // S3 itself rejects anything bigger
      ['eq', '$Content-Type', contentType],
      ...Object.entries(metaFields).map(([k, v]) => ['eq', `$${k}`, v]),
    ],
    Fields: { 'Content-Type': contentType, ...metaFields },
    Expires: 900,
  });
}

async function presignDownload(key) {
  if (LOCAL_DIR) return `/local-s3/files/${key.split('/').map(encodeURIComponent).join('/')}`;
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: process.env.UPLOADS_BUCKET, Key: key }), { expiresIn: 600 });
}

async function headMetadata(bucket, key) {
  if (LOCAL_DIR) {
    const metaFile = path.join(LOCAL_DIR, `${key}.meta.json`);
    return fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
  }
  const head = await client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  return head.Metadata || {};
}

module.exports = { presignUpload, presignDownload, headMetadata };
