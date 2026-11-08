import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { dynamoDb } from "../lib/aws-clients.js";

export type ProjectStatus =
  | "CREATED"
  | "CAPTURING"
  | "CAPTURED"
  | "GENERATING"
  | "READY"
  | "PUBLISHED"
  | "FAILED";

export interface ProjectRecord {
  projectId: string;
  businessName: string;
  sourceUrl?: string;
  slug: string;
  description?: string;

  status: ProjectStatus;
  latestVersion: number;

  captureS3Key?: string;
  desktopScreenshotKey?: string;
  mobileScreenshotKey?: string;

  publishedVersion?: number;

  createdAt: string;
  updatedAt: string;
}

function getTableName(): string {
  const table = process.env.PROJECTS_TABLE;

  if (!table) {
    throw new Error("PROJECTS_TABLE environment variable is missing.");
  }

  return table;
}

/**
 * Create a new website project.
 */
export async function createProject(project: ProjectRecord): Promise<void> {
  await dynamoDb.send(
    new PutCommand({
      TableName: getTableName(),
      Item: project,
      ConditionExpression: "attribute_not_exists(projectId)",
    }),
  );
}

/**
 * Retrieve a project using its ID.
 */
export async function getProject(
  projectId: string,
): Promise<ProjectRecord | null> {
  const result = await dynamoDb.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { projectId },
    }),
  );

  return (result.Item as ProjectRecord | undefined) ?? null;
}

/**
 * Update a project's processing status.
 */
export async function setProjectStatus(
  projectId: string,
  status: ProjectStatus,
): Promise<void> {
  await dynamoDb.send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { projectId },
      UpdateExpression: "SET #projectStatus = :status, updatedAt = :updatedAt",
      ConditionExpression: "attribute_exists(projectId)",
      ExpressionAttributeNames: {
        "#projectStatus": "status",
      },
      ExpressionAttributeValues: {
        ":status": status,
        ":updatedAt": new Date().toISOString(),
      },
    }),
  );
}

/**
 * Advance the project's latest Blueprint version.
 * The expected version prevents concurrent edits from overwriting
 * one another.
 */
export async function advanceLatestVersion(
  projectId: string,
  expectedVersion: number,
  nextVersion: number,
): Promise<void> {
  if (nextVersion !== expectedVersion + 1) {
    throw new Error("Blueprint versions must increase by exactly one.");
  }

  await dynamoDb.send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { projectId },
      UpdateExpression: "SET latestVersion = :next, updatedAt = :updatedAt",
      ConditionExpression:
        "attribute_exists(projectId) AND latestVersion = :expected",
      ExpressionAttributeValues: {
        ":expected": expectedVersion,
        ":next": nextVersion,
        ":updatedAt": new Date().toISOString(),
      },
    }),
  );
}
export async function setProjectCapture(
  projectId: string,
  keys: {
    captureS3Key: string;
    desktopScreenshotKey: string;
    mobileScreenshotKey: string;
  },
): Promise<void> {
  await dynamoDb.send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { projectId },
      UpdateExpression: `
        SET captureS3Key = :captureKey,
            desktopScreenshotKey = :desktopKey,
            mobileScreenshotKey = :mobileKey,
            #projectStatus = :status,
            updatedAt = :updatedAt
      `,
      ConditionExpression: "attribute_exists(projectId)",
      ExpressionAttributeNames: {
        "#projectStatus": "status",
      },
      ExpressionAttributeValues: {
        ":captureKey": keys.captureS3Key,
        ":desktopKey": keys.desktopScreenshotKey,
        ":mobileKey": keys.mobileScreenshotKey,
        ":status": "CAPTURED",
        ":updatedAt": new Date().toISOString(),
      },
    }),
  );
}

export async function updateProjectDetails(
  projectId: string,
  details: {
    businessName: string;
    slug: string;
    description?: string;
  },
): Promise<void> {
  await dynamoDb.send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { projectId },
      UpdateExpression: `
        SET businessName = :businessName,
            slug = :slug,
            description = :description,
            updatedAt = :updatedAt
      `,
      ConditionExpression: "attribute_exists(projectId)",
      ExpressionAttributeValues: {
        ":businessName": details.businessName,
        ":slug": details.slug,
        ":description": details.description ?? "",
        ":updatedAt": new Date().toISOString(),
      },
    }),
  );
}
