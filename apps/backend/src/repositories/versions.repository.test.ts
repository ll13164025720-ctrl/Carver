import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

import { mockClient } from "aws-sdk-client-mock";

import {
  createBlueprintVersion,
  getBlueprintVersion,
  listBlueprintVersions,
  makeVersionId,
  type BlueprintVersionRecord,
} from "./versions.repository.js";

const dynamoMock = mockClient(DynamoDBDocumentClient);

const testVersion: BlueprintVersionRecord = {
  projectId: "project-123",
  versionId: "v000001",
  versionNumber: 1,
  s3Key: "projects/project-123/blueprints/v000001.json",
  changeType: "INITIAL",
  createdAt: "2026-11-07T12:00:00.000Z",
};

const originalTable = process.env.VERSIONS_TABLE;

beforeEach(() => {
  dynamoMock.reset();
  process.env.VERSIONS_TABLE = "test-versions-table";
});

afterEach(() => {
  dynamoMock.reset();

  if (originalTable === undefined) {
    delete process.env.VERSIONS_TABLE;
  } else {
    process.env.VERSIONS_TABLE = originalTable;
  }
});

describe("makeVersionId", () => {
  it("generates a padded version ID", () => {
    expect(makeVersionId(1)).toBe("v000001");
    expect(makeVersionId(25)).toBe("v000025");
  });

  it("rejects invalid version numbers", () => {
    expect(() => makeVersionId(0)).toThrow();
    expect(() => makeVersionId(-1)).toThrow();
    expect(() => makeVersionId(1.5)).toThrow();
  });
});

describe("createBlueprintVersion", () => {
  it("saves version metadata to DynamoDB", async () => {
    dynamoMock.on(PutCommand).resolves({});

    await createBlueprintVersion(testVersion);

    const calls = dynamoMock.commandCalls(PutCommand);

    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toMatchObject({
      TableName: "test-versions-table",
      Item: testVersion,
    });
  });
});

describe("getBlueprintVersion", () => {
  it("returns version metadata when it exists", async () => {
    dynamoMock.on(GetCommand).resolves({
      Item: testVersion,
    });

    const result = await getBlueprintVersion("project-123", "v000001");

    expect(result).toEqual(testVersion);
  });

  it("returns null when the version does not exist", async () => {
    dynamoMock.on(GetCommand).resolves({});

    const result = await getBlueprintVersion("project-123", "v000001");

    expect(result).toBeNull();
  });
});

describe("listBlueprintVersions", () => {
  it("returns version history newest first", async () => {
    const versions = [
      testVersion,
      {
        ...testVersion,
        versionId: "v000002",
        versionNumber: 2,
        changeType: "EDIT" as const,
      },
    ];

    dynamoMock.on(QueryCommand).resolves({
      Items: versions,
    });

    const result = await listBlueprintVersions("project-123", 10);

    expect(result).toEqual(versions);

    const calls = dynamoMock.commandCalls(QueryCommand);

    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toMatchObject({
      TableName: "test-versions-table",
      ScanIndexForward: false,
      Limit: 10,
    });
  });

  it("returns an empty array when no versions exist", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: undefined,
    });

    const result = await listBlueprintVersions("project-123");

    expect(result).toEqual([]);
  });
});
