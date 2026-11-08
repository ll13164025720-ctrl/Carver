import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { dynamoDb } from "../lib/aws-clients.js";

export interface BlueprintVersionRecord {
  projectId: string;

  // Padded IDs preserve chronological sorting:
  // v000001, v000002, v000003...
  versionId: string;

  versionNumber: number;
  s3Key: string;

  changeType: "INITIAL" | "EDIT";
  prompt?: string;

  createdAt: string;
}

function getTableName(): string {
  const table = process.env.VERSIONS_TABLE;

  if (!table) {
    throw new Error("VERSIONS_TABLE environment variable is missing.");
  }

  return table;
}

export function makeVersionId(versionNumber: number): string {
  if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) {
    throw new Error("Invalid Blueprint version number.");
  }

  return `v${String(versionNumber).padStart(6, "0")}`;
}

/**
 * Save metadata for a Blueprint version.
 * The actual Blueprint JSON is stored in S3.
 */
export async function createBlueprintVersion(
  version: BlueprintVersionRecord,
): Promise<void> {
  await dynamoDb.send(
    new PutCommand({
      TableName: getTableName(),
      Item: version,
      ConditionExpression:
        "attribute_not_exists(projectId) AND attribute_not_exists(versionId)",
    }),
  );
}

/**
 * Retrieve a particular Blueprint version's metadata.
 */
export async function getBlueprintVersion(
  projectId: string,
  versionId: string,
): Promise<BlueprintVersionRecord | null> {
  const result = await dynamoDb.send(
    new GetCommand({
      TableName: getTableName(),
      Key: {
        projectId,
        versionId,
      },
    }),
  );

  return (result.Item as BlueprintVersionRecord | undefined) ?? null;
}

/**
 * List version history, newest first.
 */
export async function listBlueprintVersions(
  projectId: string,
  requestedLimit = 50,
): Promise<BlueprintVersionRecord[]> {
  const limit = Math.max(1, Math.min(requestedLimit, 100));

  const result = await dynamoDb.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "projectId = :projectId",
      ExpressionAttributeValues: {
        ":projectId": projectId,
      },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );

  return (result.Items ?? []) as BlueprintVersionRecord[];
}
