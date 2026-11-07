import { lookup } from "node:dns/promises";
import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { BlockList, isIP } from "node:net";
import { basename, extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, type Browser, type Route, type Page } from "playwright";
import {
  CaptureSiteRequestSchema,
  WebsiteCaptureSchema,
  type WebsiteCapture,
} from "@siterevive/shared";

const PORT = Number(process.env.PORT ?? 3002);
const HOST = process.env.HOST ?? "0.0.0.0";
const ARTIFACT_DIR = resolve(process.cwd(), ".data", "captures");
const MAX_BODY_BYTES = 16 * 1024;
const NAVIGATION_TIMEOUT_MS = 14_000;
const MAX_TEXT_LENGTH = 20_000;

// Block private, loopback, link-local, documentation, multicast and reserved
// address ranges. This prevents the capture endpoint being used to probe local
// services or cloud instance metadata endpoints.
const blockedAddresses = new BlockList();
const blockedMappedIpv4Addresses = new BlockList();

for (const [range, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(range, prefix, "ipv4");
  // Apply the same IPv4 blocks to IPv4-mapped IPv6 addresses without blocking
  // the entire ::ffff:0:0/96 range (which would match every mapped IPv4).
  blockedMappedIpv4Addresses.addSubnet(`::ffff:${range}`, prefix + 96, "ipv6");
}

for (const [range, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(range, prefix, "ipv6");
}

function isBlockedIp(address: string): boolean {
  const family = isIP(address);

  if (family === 0) return true;

  if (family === 4) {
    return blockedAddresses.check(address, "ipv4");
  }

  return (
    blockedAddresses.check(address, "ipv6") ||
    blockedMappedIpv4Addresses.check(address, "ipv6")
  );
}

async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Enter a valid website URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS websites can be captured.");
  }
  if (url.username || url.password) {
    throw new Error("Website URLs must not contain usernames or passwords.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Local and internal network addresses cannot be captured.");
  }

  const literalFamily = isIP(hostname);
  if (literalFamily !== 0) {
    if (isBlockedIp(hostname)) {
      throw new Error("Private or reserved IP addresses cannot be captured.");
    }
    return url;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("The website hostname could not be resolved.");
  }

  if (
    addresses.length === 0 ||
    addresses.some((record) => isBlockedIp(record.address))
  ) {
    throw new Error(
      "The website resolves to a private or reserved IP address.",
    );
  }

  return url;
}

async function routeOnlyPublicHttpRequests(route: Route): Promise<void> {
  const requestUrl = route.request().url();
  try {
    await assertPublicHttpUrl(requestUrl);
    await route.continue();
  } catch {
    await route.abort("blockedbyclient");
  }
}

function cleanText(value: unknown, maxLength = 500): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

type ExtractedPageData = {
  title: string;
  description: string;
  headings: Array<{ level: number; text: string }>;
  links: Array<{ text: string; url: string }>;
  images: Array<{ src: string; alt: string }>;
  text: string;
};

async function extractPageData(
  page: Page,
  maxLength: number,
): Promise<ExtractedPageData> {
  // Pass a JavaScript expression string rather than a TypeScript callback.
  // tsx/esbuild can inject a module-scoped __name() helper into callbacks;
  // Playwright serializes the callback without that outer module scope, causing
  // "ReferenceError: __name is not defined" in the browser. This self-contained
  // expression is evaluated as written in the page context and avoids that issue.
  const safeMaxLength = Number.isFinite(maxLength)
    ? Math.max(0, Math.min(Math.floor(maxLength), 100_000))
    : MAX_TEXT_LENGTH;

  const expression = `(() => {
    function normalize(value, limit) {
      const text = typeof value === "string" ? value : "";
      return text.replace(/\\s+/g, " ").trim().slice(0, limit);
    }

    const descriptionElement =
      document.querySelector('meta[name="description"]') ||
      document.querySelector('meta[property="og:description"]');
    const description = descriptionElement
      ? descriptionElement.getAttribute("content") || ""
      : "";

    const headings = Array.from(
      document.querySelectorAll("h1,h2,h3,h4,h5,h6")
    )
      .map(function (element) {
        return {
          level: Number(element.tagName.slice(1)),
          text: normalize(element.textContent, 500)
        };
      })
      .filter(function (item) { return item.text.length > 0; })
      .slice(0, 100);

    const links = Array.from(document.querySelectorAll("a[href]"))
      .map(function (anchor) {
        return {
          text: normalize(
            anchor.innerText || anchor.getAttribute("aria-label"),
            300
          ),
          url: anchor.href
        };
      })
      .filter(function (item) {
        return item.url && /^(https?:|mailto:|tel:)/i.test(item.url);
      })
      .filter(function (item, index, all) {
        return all.findIndex(function (candidate) {
          return candidate.url === item.url;
        }) === index;
      })
      .slice(0, 100);

    const images = Array.from(document.querySelectorAll("img"))
      .map(function (image) {
        return {
          src: image.currentSrc || image.src,
          alt: normalize(image.alt, 500)
        };
      })
      .filter(function (item) { return /^https?:/i.test(item.src); })
      .filter(function (item, index, all) {
        return all.findIndex(function (candidate) {
          return candidate.src === item.src;
        }) === index;
      })
      .slice(0, 100);

    return {
      title: normalize(document.title, 300),
      description: normalize(description, 1000),
      headings: headings,
      links: links,
      images: images,
      text: normalize(document.body ? document.body.innerText : "", ${JSON.stringify(safeMaxLength)})
    };
  })()`;

  return (await page.evaluate(expression)) as ExtractedPageData;
}

async function captureWebsite(sourceUrl: string): Promise<WebsiteCapture> {
  const normalizedUrl = await assertPublicHttpUrl(sourceUrl);
  await mkdir(ARTIFACT_DIR, { recursive: true });

  let browser: Browser | undefined;
  const captureId = randomUUID();
  const desktopFile = `${captureId}-desktop.png`;
  const mobileFile = `${captureId}-mobile.png`;
  const desktopPath = resolve(ARTIFACT_DIR, desktopFile);
  const mobilePath = resolve(ARTIFACT_DIR, mobileFile);

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
      serviceWorkers: "block",
      ignoreHTTPSErrors: false,
    });
    await context.route("**/*", routeOnlyPublicHttpRequests);

    const page = await context.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    page.setDefaultTimeout(4_000);

    const navigation = await page.goto(normalizedUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    if (!navigation || !navigation.ok()) {
      const status = navigation?.status();
      throw new Error(
        status
          ? `The website responded with HTTP ${status}.`
          : "The website could not be loaded.",
      );
    }

    // Some sites continue loading analytics forever. A short network-idle wait
    // improves screenshots without making the capture depend on every request.
    await page
      .waitForLoadState("networkidle", { timeout: 1_500 })
      .catch(() => undefined);

    const pageData = await extractPageData(page, MAX_TEXT_LENGTH);

    await page.screenshot({
      path: desktopPath,
      fullPage: true,
      animations: "disabled",
      timeout: 4_000,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: mobilePath,
      fullPage: true,
      animations: "disabled",
      timeout: 4_000,
    });

    const finalUrl = page.url();
    await context.close();

    return WebsiteCaptureSchema.parse({
      captureId,
      sourceUrl: normalizedUrl.toString(),
      finalUrl,
      capturedAt: new Date().toISOString(),
      title: cleanText(pageData.title, 300),
      description: cleanText(pageData.description, 1000),
      headings: pageData.headings,
      text: cleanText(pageData.text, MAX_TEXT_LENGTH),
      links: pageData.links,
      images: pageData.images,
      screenshots: {
        desktop: `/artifacts/${desktopFile}`,
        mobile: `/artifacts/${mobileFile}`,
      },
    });
  } catch (error) {
    await Promise.all([
      import("node:fs/promises").then(({ rm }) =>
        rm(desktopPath, { force: true }),
      ),
      import("node:fs/promises").then(({ rm }) =>
        rm(mobilePath, { force: true }),
      ),
    ]).catch(() => undefined);
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin":
      process.env.CAPTURE_CORS_ORIGIN ?? "http://localhost:3000",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function sendArtifact(response: ServerResponse, filePath: string): void {
  response.writeHead(200, {
    "content-type": "image/png",
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin":
        process.env.CAPTURE_CORS_ORIGIN ?? "http://localhost:3000",
      "access-control-allow-headers": "content-type,authorization",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    });
    response.end();
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/health") {
    sendJson(response, 200, { ok: true, service: "siterevive-capture-worker" });
    return;
  }

  if (
    request.method === "GET" &&
    requestUrl.pathname.startsWith("/artifacts/")
  ) {
    const fileName = basename(requestUrl.pathname);
    if (
      !/^[0-9a-f-]{36}-(desktop|mobile)\.png$/i.test(fileName) ||
      extname(fileName) !== ".png"
    ) {
      sendJson(response, 400, { error: "Invalid artifact path." });
      return;
    }

    const filePath = resolve(ARTIFACT_DIR, fileName);
    try {
      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) throw new Error("Not a file");
      sendArtifact(response, filePath);
    } catch {
      sendJson(response, 404, { error: "Screenshot not found." });
    }
    return;
  }

  if (request.method !== "POST" || requestUrl.pathname !== "/capture") {
    sendJson(response, 404, { error: "Route not found." });
    return;
  }

  const expectedToken = process.env.CAPTURE_WORKER_TOKEN;
  if (
    expectedToken &&
    request.headers.authorization !== `Bearer ${expectedToken}`
  ) {
    sendJson(response, 401, { error: "Unauthorized capture request." });
    return;
  }

  try {
    const rawBody = await readJsonBody(request);
    const parsedRequest = CaptureSiteRequestSchema.safeParse(rawBody);
    if (!parsedRequest.success) {
      sendJson(response, 400, {
        error: "Invalid capture request.",
        details: parsedRequest.error.issues,
      });
      return;
    }

    const capture = await captureWebsite(parsedRequest.data.sourceUrl);
    sendJson(response, 200, { ok: true, capture });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Capture failed.";
    const status =
      /valid website URL|HTTP and HTTPS|username|Local and internal|Private or reserved|hostname could not be resolved|resolves to a private/i.test(
        message,
      )
        ? 400
        : 502;
    sendJson(response, status, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SiteRevive capture worker listening on http://${HOST}:${PORT}`);
  console.log(`Screenshot artifacts: ${ARTIFACT_DIR}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
