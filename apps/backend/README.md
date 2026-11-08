# SiteRevive backend

The backend is an AWS Lambda HTTP API built with AWS SAM and the AWS SDK for JavaScript Bedrock Converse API.

## Local run

Confirm your temporary Workshop session is active (do not paste credentials into source files or chat):

```bash
export AWS_DEFAULT_REGION=us-east-1
export AWS_REGION=us-east-1
aws sts get-caller-identity
```

Start the Playwright capture worker in one terminal with `npm run dev:capture`. In another terminal, build and start the local Lambda API from the repository root:

```bash
npm run build:backend
npm run dev:backend
```

Docker Desktop must be running for `sam local`.

## Routes

- `GET /health` — API status and configured Bedrock model.
- `POST /api/captures` — forwards a URL to the capture worker and returns extracted page data, screenshot URLs, and a preformatted `sourceContent` string for generation.
- `POST /api/blueprints/generate` — asks Bedrock for a Website Blueprint and validates it with the shared Zod schema.
- `POST /api/blueprints/edit` — asks Bedrock for structured section-content operations, validates them, applies them to a copy, and validates the resulting Blueprint.

The local SAM template points to `http://host.docker.internal:3002/capture` because the Lambda emulator runs in Docker while the capture worker runs on the Mac host. The browser-facing screenshot base is `http://localhost:3002`.

## Model configuration

The Python helper and TypeScript backend are configured to use
the Amazon Bedrock inference profile:

`us.meta.llama4-scout-17b-instruct-v1:0`

Both use the Bedrock Converse API.

The TypeScript backend reads its model configuration from
`BEDROCK_MODEL_ID`, which can be changed to another inference
profile enabled in the AWS Workshop account.

## Deployment notes

The deployed capture architecture is not configured yet. Before deployment, replace the local worker URL with a private service endpoint or move capture to a queued worker, store screenshots in a private S3 bucket, and configure authentication and rate limits. Confirm the hackathon's cross-region inference-profile policy before deployment. The template currently uses `Resource: "*"` for `bedrock:InvokeModel` as a hackathon MVP convenience; narrow this before production.
