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
- `POST /api/captures` — forwards a URL to the capture worker, persists the capture and screenshots in private S3, and returns the project ID and extracted page data.
- `POST /api/blueprints/generate` — prefers the persisted capture for the project, asks Bedrock for a Website Blueprint, validates it, and saves version 1.
- `POST /api/blueprints/edit` — loads the latest saved Blueprint, asks Bedrock for structured edit operations, validates/applies them, and saves the next version.
- `GET /api/projects/{projectId}` — returns project metadata and the latest saved Blueprint.
- `GET /api/projects/{projectId}/versions` — returns version history, newest first.
- `GET /api/projects/{projectId}/versions/{versionNumber}` — returns a particular saved Blueprint version.
- `POST /api/projects/{projectId}/publish` — body `{ "versionNumber"?: number }` (defaults to the latest). Snapshots that version as a standalone page in S3, marks the project `PUBLISHED`, and returns `{ publishedVersion, publishedAt, siteUrl }`. Edits made afterwards do not change the live site until it is published again.
- `POST /api/projects/{projectId}/unpublish` — takes the site offline. Saved versions are kept.
- `GET /api/projects/{projectId}/export?version=N` — downloads a version as one standalone `.html` file the owner can host anywhere (works without publishing).
- `GET /sites/{projectId}` — the public published website. Served with a restrictive Content-Security-Policy and `sandbox` (no network access, no forms, opaque origin).

Set `PUBLIC_SITES_BASE_URL` (for example a CloudFront or custom-domain origin in front of the API) if published links should not use the API's own host. There is no authentication yet: anyone who knows a project ID can publish or unpublish it, so add auth before production.

The local SAM template points to `http://host.docker.internal:3002/capture` because the Lambda emulator runs in Docker while the capture worker runs on the Mac host. The browser-facing screenshot base is `http://localhost:3002`.

## Model configuration

The Python helpers and TypeScript backend use the Amazon Bedrock US inference
profile for Claude Sonnet 5:

`us.anthropic.claude-sonnet-5`

The TypeScript backend reads `BEDROCK_MODEL_ID` from the SAM template (or the
environment). Claude Sonnet 5 supports Bedrock's Converse API. It uses adaptive
thinking by default, so the backend does not set non-default sampling
parameters such as temperature or topP.

The capture worker crawls the homepage and up to seven discovered same-origin subpages per request (eight pages total), with page-count, concurrency, and time limits. The Workshop account must have access to the model and inference profile.

## Deployment notes

The deployed capture architecture is not configured yet. Before deployment, replace the local worker URL with a private service endpoint or move capture to a queued worker, store screenshots in a private S3 bucket, and configure authentication and rate limits. Confirm the hackathon's cross-region inference-profile policy before deployment. The template currently uses `Resource: "*"` for `bedrock:InvokeModel` as a hackathon MVP convenience; narrow this before production.
