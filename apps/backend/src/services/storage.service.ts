import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import { s3Client } from "../lib/aws-clients.js";

function getBucketName(): string {
  const bucket = process.env.ASSETS_BUCKET;

  if (!bucket) {
    throw new Error("ASSETS_BUCKET environment variable is missing.");
  }

  return bucket;
}

function validateKey(key: string): void {
  const segments = key.split("/");
  if (
    !key ||
    key.trim() !== key ||
    !key.startsWith("projects/") ||
    key.startsWith("/") ||
    segments.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Invalid S3 object key.");
  }
}

/**
 * Upload a JSON object to S3.
 */
export async function uploadJson(key: string, data: unknown): Promise<void> {
  validateKey(key);

  const body = JSON.stringify(data);

  if (body === undefined) {
    throw new Error("Unable to serialize data as JSON.");
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: key,
      Body: body,
      ContentType: "application/json; charset=utf-8",
    }),
  );
}

/**
 * Retrieve and parse a JSON object from S3.
 * Returns null if the object does not exist.
 */
export async function getJson<T>(key: string): Promise<T | null> {
  validateKey(key);

  try {
    const result = await s3Client.send(
      new GetObjectCommand({
        Bucket: getBucketName(),
        Key: key,
      }),
    );

    if (!result.Body) {
      return null;
    }

    const body = await result.Body.transformToString("utf-8");

    return JSON.parse(body) as T;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "NoSuchKey" || error.name === "NotFound")
    ) {
      return null;
    }

    throw error;
  }
}

/**
 * Upload an image, screenshot, or other binary asset.
 */
export async function uploadBytes(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  validateKey(key);

  await s3Client.send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}
