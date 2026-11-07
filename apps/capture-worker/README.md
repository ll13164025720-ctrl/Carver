# SiteRevive capture worker

A small Playwright service used by the local hackathon MVP. It captures one page per request and returns metadata, headings, visible text, links, image URLs, and desktop/mobile screenshots.

## Run

From the repository root:

```bash
npx playwright install chromium
npm run dev:capture
```

The worker listens on port `3002` by default.

- `GET http://localhost:3002/health`
- `POST http://localhost:3002/capture` with `{"sourceUrl":"https://example.com"}`
- Screenshots are saved in `.data/captures/` and served from `/artifacts/<capture-id>-desktop.png` and `/artifacts/<capture-id>-mobile.png`.

The worker binds to `0.0.0.0` so a local SAM Lambda container can reach it using `host.docker.internal`. Keep it on a trusted development machine. `CAPTURE_WORKER_TOKEN` enables bearer-token authentication; configure the same token in the worker process and Lambda environment when using it. Do not commit tokens.

The worker rejects localhost/private/reserved addresses and validates browser request destinations to reduce SSRF risk. This remains an MVP defense; production deployment needs private networking, egress controls, DNS rebinding protection, authentication, rate limits, and S3-backed artifact storage.
