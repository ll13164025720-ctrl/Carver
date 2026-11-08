import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";

const region = process.env.AWS_REGION ?? "us-east-1";

const dynamoClient = new DynamoDBClient({
  region,
});

export const dynamoDb = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

export const s3Client = new S3Client({
  region,
});
