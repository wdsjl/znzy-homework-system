const fs = require('fs/promises');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

function createStorage({ localRoot, publicBasePath = '/uploads' }) {
  let s3Client;

  function driver() {
    return (process.env.FILE_STORAGE_DRIVER || process.env.OBJECT_STORAGE_DRIVER || 'local').toLowerCase();
  }

  function getS3Client() {
    if (s3Client) return s3Client;
    s3Client = new S3Client({
      endpoint: process.env.S3_ENDPOINT || process.env.OSS_ENDPOINT || undefined,
      region: process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1',
      forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || '1') !== '0',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || process.env.OSS_SECRET_ACCESS_KEY || '',
      },
    });
    return s3Client;
  }

  async function saveBuffer({ buffer, fileName, contentType = 'application/octet-stream', folder = 'grading', key }) {
    const safeName = sanitizeFileName(fileName || 'file.bin');
    const objectKey = key || `${folder}/${Date.now()}-${safeName}`;
    if (driver() === 's3' || driver() === 'oss' || driver() === 'minio') {
      const bucket = process.env.S3_BUCKET || process.env.OSS_BUCKET || process.env.MINIO_BUCKET;
      if (!bucket) throw new Error('S3_BUCKET/OSS_BUCKET is required for object storage');
      await getS3Client().send(new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: buffer,
        ContentType: contentType,
      }));
      const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL || process.env.OSS_PUBLIC_BASE_URL || '';
      return {
        driver: driver(),
        bucket,
        key: objectKey,
        fileName: safeName,
        url: publicBaseUrl ? `${publicBaseUrl.replace(/\/$/, '')}/${objectKey}` : `s3://${bucket}/${objectKey}`,
      };
    }

    const fullPath = path.join(localRoot, objectKey);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    return {
      driver: 'local',
      key: objectKey,
      fileName: safeName,
      path: fullPath,
      url: `${publicBasePath}/${objectKey}`.replace(/\/+/g, '/'),
    };
  }

  return { driver, saveBuffer };
}

function sanitizeFileName(name = 'file.bin') {
  return String(name).replace(/[^\w.-]+/g, '_').slice(-140) || 'file.bin';
}

module.exports = { createStorage, sanitizeFileName };
