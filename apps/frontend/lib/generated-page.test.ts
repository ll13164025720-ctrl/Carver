import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

import { createHash } from "node:crypto"

import {
  MAX_HTML_LENGTH,
  MAX_JAVASCRIPT_LENGTH,
  MAX_PAGE_LENGTH,
  PAGE_SANDBOX,
  buildPageDocument,
  pageContentKey,
  pageContentSecurityPolicy,
  parseFrameMessage,
  parseGeneratedPage,
  safeBaseUrl,
} from "@/lib/generated-page"
import type { GeneratedPage } from "@/types/website"

/**
 * The page is untrusted code. These tests pin down exactly what is accepted and
 * how it is packaged. Whether the browser really enforces the sandbox is
 * tested in a real browser (see the end-to-end run in the project notes).
 */

const PAGE: GeneratedPage = {
  html: '<header><h1 id="t">Hello</h1><a href="#about">About</a></header><section id="about"><p>About us</p></section><button id="b" type="button">Go</button>',
  css: "body{margin:0}h1{color:#123}",
  javascript: "document.getElementById('b').addEventListener('click',function(){document.getElementById('t').textContent='Clicked'});",
}
const ORIGIN = "http://localhost:3000"

function build(overrides: Partial<GeneratedPage> = {}, baseUrl: string | null = "https://joescafe.com/") {
  return buildPageDocument({ ...PAGE, ...overrides }, { baseUrl, parentOrigin: ORIGIN })
}

/** The SHA-256 the BROWSER computes for an inline script: its text between the tags, as UTF-8. */
const browserHash = (text: string) => `sha256-${createHash("sha256").update(text, "utf8").digest("base64")}`
const scriptBodies = (doc: string) => [...doc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
const policyOf = (doc: string) => /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(doc)?.[1] ?? ""

describe("parseGeneratedPage: valid output", () => {
  it("accepts a normal page and returns a clean copy", () => {
    const result = parseGeneratedPage(PAGE)
    assert.ok(result.ok)
    assert.deepEqual(result.value, PAGE)
    assert.notEqual(result.value, PAGE)
  })

  it("accepts a real page written by the model (recorded fixture)", () => {
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/real-generated-website.json", import.meta.url), "utf8"))
    const result = parseGeneratedPage(fixture.website)
    assert.ok(result.ok, result.ok ? "" : result.error)
    assert.ok(result.value.html.length > 1000 && result.value.css.length > 1000)
    // It has real interactivity for the sandbox to support.
    assert.match(result.value.javascript, /addEventListener/)
    assert.doesNotThrow(() => build(result.value))
  })

  it("treats a missing javascript field as empty, like the backend's schema", () => {
    const result = parseGeneratedPage({ html: "<p>x</p>", css: "" })
    assert.ok(result.ok)
    assert.equal(result.value.javascript, "")
  })

  it("accepts empty css", () => {
    assert.ok(parseGeneratedPage({ html: "<p>x</p>", css: "", javascript: "" }).ok)
  })
})

describe("parseGeneratedPage: malformed output", () => {
  it("rejects values that are not a page", () => {
    for (const value of [null, undefined, "text", 5, [], [PAGE]]) {
      assert.equal(parseGeneratedPage(value).ok, false, String(value))
    }
  })

  it("rejects fields of the wrong type or missing", () => {
    const cases: unknown[] = [
      { css: "", javascript: "" },
      { html: 5, css: "", javascript: "" },
      { html: "<p>x</p>", javascript: "" },
      { html: "<p>x</p>", css: ["a"], javascript: "" },
      { html: "<p>x</p>", css: "", javascript: 12 },
      { html: "<p>x</p>", css: "", javascript: null },
      { html: "", css: "", javascript: "" },
      { html: "   \n  ", css: "", javascript: "" },
    ]
    for (const value of cases) assert.equal(parseGeneratedPage(value).ok, false, JSON.stringify(value))
  })

  it("gives a reason for developers on every rejection", () => {
    const result = parseGeneratedPage({ html: "", css: "", javascript: "" })
    assert.ok(!result.ok && result.error.length > 0)
  })
})

describe("parseGeneratedPage: code that could escape the sandbox document", () => {
  const rejected: Array<[string, Partial<GeneratedPage>]> = [
    ["a script element", { html: "<p>a</p><script>alert(1)</script>" }],
    ["a script element with attributes and odd case", { html: "<ScRiPt src=x></ScRiPt>" }],
    ["a script element with a space after <", { html: "< script>1</script>" }],
    ["a style element", { html: "<style>body{}</style>" }],
    ["an iframe", { html: '<iframe src="https://evil.example"></iframe>' }],
    ["an object", { html: '<object data="x"></object>' }],
    ["an embed", { html: '<embed src="x">' }],
    ["a meta refresh", { html: '<meta http-equiv="refresh" content="0;url=https://evil.example">' }],
    ["a meta element", { html: '<meta name="x" content="y">' }],
    ["a base element", { html: '<base href="https://evil.example/">' }],
    ["an inline onclick", { html: '<button onclick="x()">a</button>' }],
    ["an inline handler in any case", { html: '<img src=x ONERROR=alert(1)>' }],
    ["an inline handler after a newline", { html: '<img src="x"\nonerror="alert(1)">' }],
    ["a javascript: link", { html: '<a href="javascript:alert(1)">a</a>' }],
    ["a javascript: link with a space", { html: '<a href="JavaScript :alert(1)">a</a>' }],
    ["@import in the css", { css: '@import url("https://evil.example/x.css");' }],
    ["a closing style tag in the css", { css: "a{}</style><script>alert(1)</script>" }],
    ["a closing script tag in the javascript", { javascript: "var a=1;</script><img src=x>" }],
    ["a closing script tag in any case", { javascript: "</SCRIPT>" }],
    ["an HTML comment opener in the javascript", { javascript: "var s='<!--';" }],
  ]
  for (const [name, override] of rejected) {
    it(`rejects ${name}`, () => {
      const result = parseGeneratedPage({ ...PAGE, ...override })
      assert.equal(result.ok, false)
      assert.throws(() => buildPageDocument({ ...PAGE, ...override }, { parentOrigin: ORIGIN }))
    })
  }

  it("does not reject harmless text that only looks similar", () => {
    const result = parseGeneratedPage({
      html: "<p>Onion rings and one-on-one lessons. Contact: javascript lessons for kids. A &lt;script&gt; mention.</p><a href=\"#one\">1</a>",
      css: ".a{content:'@importance'}",
      javascript: "var s = 'script'; var done = 1 < 2;",
    })
    assert.ok(result.ok, result.ok ? "" : result.error)
  })

  it("enforces the size limits the backend enforces", () => {
    assert.equal(parseGeneratedPage({ ...PAGE, html: "a".repeat(MAX_HTML_LENGTH + 1) }).ok, false)
    assert.equal(parseGeneratedPage({ ...PAGE, javascript: "a".repeat(MAX_JAVASCRIPT_LENGTH + 1) }).ok, false)
    assert.equal(
      parseGeneratedPage({ html: "a".repeat(100_000), css: "b".repeat(100_000), javascript: "c".repeat(1) }).ok,
      false,
      `the combined limit is ${MAX_PAGE_LENGTH}`
    )
    assert.ok(parseGeneratedPage({ html: "a".repeat(MAX_HTML_LENGTH), css: "", javascript: "" }).ok)
  })
})

describe("agreement with the backend's own schema (packages/shared)", () => {
  async function backendSchema() {
    const path = "../../../packages/shared/src/index.ts"
    try {
      return (await import(path)).GeneratedWebsiteSchema as { safeParse(value: unknown): { success: boolean } }
    } catch {
      return null
    }
  }

  it("never accepts a page the backend would reject, and only rejects extra on purpose", async (t) => {
    const schema = await backendSchema()
    if (!schema) return t.skip("packages/shared is not available here")

    const samples: unknown[] = [
      PAGE,
      { ...PAGE, javascript: undefined },
      { html: "", css: "", javascript: "" },
      { html: "<script>1</script>", css: "", javascript: "" },
      { html: "<p onclick=x>a</p>", css: "", javascript: "" },
      { html: '<a href="javascript:1">a</a>', css: "", javascript: "" },
      { html: "<p>a</p>", css: "@import 'x';", javascript: "" },
      { html: "<p>a</p>", css: "</style>", javascript: "" },
      { html: "<p>a</p>", css: "", javascript: "</script>" },
      { html: "a".repeat(MAX_HTML_LENGTH + 1), css: "", javascript: "" },
      { html: "<p>a</p>", css: "", javascript: "a".repeat(MAX_JAVASCRIPT_LENGTH + 1) },
      { html: "a".repeat(100_000), css: "b".repeat(100_000), javascript: "c" },
    ]
    for (const sample of samples) {
      const backend = schema.safeParse(sample).success
      const frontend = parseGeneratedPage(sample).ok
      if (!backend) assert.equal(frontend, false, `accepted what the backend rejects: ${JSON.stringify(sample).slice(0, 80)}`)
      else assert.equal(frontend, true, `rejected what the backend accepts: ${JSON.stringify(sample).slice(0, 80)}`)
    }

    // The two intentional differences: elements that cannot be neutralized by the
    // Content-Security-Policy and that "body markup only" never needs.
    for (const html of ['<meta http-equiv="refresh" content="0;url=https://evil.example">', '<base href="https://evil.example/">']) {
      const sample = { html: `<p>a</p>${html}`, css: "", javascript: "" }
      assert.equal(schema.safeParse(sample).success, true, "backend allows it")
      assert.equal(parseGeneratedPage(sample).ok, false, "frontend refuses it")
    }
  })
})

describe("isolation: sandbox and Content-Security-Policy", () => {
  it("grants the page JavaScript and nothing else", () => {
    assert.equal(PAGE_SANDBOX, "allow-scripts")
    for (const forbidden of [
      "allow-same-origin",
      "allow-top-navigation",
      "allow-top-navigation-by-user-activation",
      "allow-popups",
      "allow-popups-to-escape-sandbox",
      "allow-forms",
      "allow-modals",
      "allow-downloads",
      "allow-pointer-lock",
      "allow-presentation",
      "allow-orientation-lock",
    ]) {
      assert.ok(!PAGE_SANDBOX.split(" ").includes(forbidden), forbidden)
    }
  })

  it("blocks every network, form, frame and plugin channel", () => {
    const policy = pageContentSecurityPolicy([browserHash("a").slice(7), browserHash("b").slice(7)])
    const directives = new Map(policy.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1).join(" ")]))
    assert.equal(directives.get("default-src"), "'none'")
    assert.equal(directives.get("connect-src"), "'none'", "no fetch, XHR, WebSocket, sendBeacon")
    assert.equal(directives.get("form-action"), "'none'")
    assert.equal(directives.get("frame-src"), "'none'")
    assert.equal(directives.get("object-src"), "'none'")
    assert.equal(directives.get("worker-src"), "'none'")
    assert.match(String(directives.get("script-src")), /^'sha256-[A-Za-z0-9+/]{43}=' 'sha256-[A-Za-z0-9+/]{43}='$/)
    assert.ok(!policy.includes("unsafe-eval"), "eval and new Function stay blocked")
    assert.ok(!/script-src[^;]*'unsafe-inline'/.test(policy), "inline handlers stay blocked")
    assert.ok(!/script-src[^;]*nonce/.test(policy), "no nonce: a nonce can be read and reused by the page")
    assert.ok(!/script-src[^;]*'strict-dynamic'/.test(policy), "scripts cannot vouch for further scripts")
    assert.ok(!/script-src[^;]*https?:/.test(policy), "no external scripts")
    assert.ok(!/style-src[^;]*https?:/.test(policy), "no external stylesheets")
  })
})

describe("buildPageDocument", () => {
  const doc = build()

  it("is a complete document with the policy as the first thing in <head>", () => {
    assert.match(doc, /^<!doctype html>/)
    const head = doc.slice(doc.indexOf("<head>"), doc.indexOf("</head>"))
    assert.ok(head.indexOf("Content-Security-Policy") < head.indexOf("<style>"), "policy comes before the page's CSS")
    assert.ok(head.indexOf("Content-Security-Policy") < head.indexOf("<base"), "policy comes before <base>")
  })

  it("puts the page's html, css and javascript in the right places, unchanged", () => {
    assert.ok(doc.includes(`<style>\n${PAGE.css}\n</style>`))
    assert.ok(doc.includes(PAGE.html))
    assert.ok(doc.includes(PAGE.javascript))
  })

  it("has exactly two scripts, with no src and no nonce to reuse", () => {
    const tags = [...doc.matchAll(/<script\b([^>]*)>/g)]
    assert.equal(tags.length, 2)
    for (const tag of tags) assert.equal(tag[1].trim(), "", "a bare <script>: no src, no nonce")
    assert.equal([...doc.matchAll(/<\/script>/g)].length, 2)
    assert.doesNotMatch(doc, /nonce/i)
  })

  it("allows exactly those two scripts, by the hash the browser will compute", () => {
    const bodies = scriptBodies(doc)
    assert.equal(bodies.length, 2)
    assert.ok(
      policyOf(doc).includes(`script-src '${browserHash(bodies[0])}' '${browserHash(bodies[1])}';`),
      policyOf(doc)
    )
  })

  it("keeps the hashes right for pages with unusual text (accents, emoji, CRLF, very long)", () => {
    for (const javascript of [
      "var s = 'café ☕ 日本語 😀';",
      "var a = 1;\r\nvar b = 2;\r\n",
      "// ".concat("x".repeat(39_000)),
      "",
      "  \n\t  var x = 1  ",
    ]) {
      const built = build({ javascript })
      const bodies = scriptBodies(built)
      assert.ok(
        policyOf(built).includes(`'${browserHash(bodies[0])}' '${browserHash(bodies[1])}'`),
        JSON.stringify(javascript).slice(0, 30)
      )
      assert.equal(bodies[1], `\n${javascript}\n`)
    }
  })

  it("a different page gets a different script hash, while the link guard's stays the same", () => {
    const a = policyOf(build({ javascript: "var a = 1;" })).match(/'sha256-[^']+'/g)
    const b = policyOf(build({ javascript: "var a = 2;" })).match(/'sha256-[^']+'/g)
    assert.ok(a && b)
    assert.equal(a[0], b[0])
    assert.notEqual(a[1], b[1])
  })

  it("a script the page adds later is not covered by any hash", () => {
    const bodies = scriptBodies(build())
    assert.ok(![browserHash(bodies[0]), browserHash(bodies[1])].includes(browserHash("window.__injected=1")))
  })

  it("resolves relative URLs against the captured site, and only for http(s) addresses", () => {
    assert.match(build({}, "https://joescafe.com/menu/"), /<base href="https:\/\/joescafe\.com\/menu\/">/)
    for (const bad of [null, undefined, "", "javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://x.example/", "not a url", "https://user:pass@x.example/"]) {
      const withoutBase = buildPageDocument(PAGE, { baseUrl: bad as string | null | undefined, parentOrigin: ORIGIN })
      assert.doesNotMatch(withoutBase, /<base\b/, String(bad))
    }
  })

  it("escapes a base address so it cannot break out of its attribute", () => {
    const doc2 = build({}, 'https://x.example/"><script nonce=x>alert(1)</script>')
    assert.equal([...doc2.matchAll(/<script\b/g)].length, 2)
    assert.doesNotMatch(doc2, /<base href="[^"]*"[^>]*>\s*<script nonce=x/)
  })

  it("tells the page's link guard to talk only to this app's origin", () => {
    assert.match(doc, /var TARGET = "http:\/\/localhost:3000"/)
    assert.doesNotMatch(doc, /postMessage\([^)]*"\*"/)
    // A path or query on the origin is dropped.
    const other = buildPageDocument(PAGE, { parentOrigin: "https://app.example/some/path?x=1" })
    assert.match(other, /var TARGET = "https:\/\/app\.example"/)
  })

  it("keeps in-page links working and blocks links to other places", () => {
    assert.match(doc, /charAt\(0\) === "#"/)
    assert.match(doc, /event\.preventDefault\(\)/)
    assert.match(doc, /scrollIntoView/)
  })

  it("opts out of sending a referrer", () => {
    assert.match(doc, /<meta name="referrer" content="no-referrer">/)
  })

  it("is deterministic: the same page gives the same document", () => {
    const a = buildPageDocument(PAGE, { baseUrl: "https://x.example/", parentOrigin: ORIGIN })
    const b = buildPageDocument(PAGE, { baseUrl: "https://x.example/", parentOrigin: ORIGIN })
    assert.equal(a, b)
  })
})

describe("safeBaseUrl", () => {
  it("accepts http(s) and normalizes", () => {
    assert.equal(safeBaseUrl("https://Joescafe.com"), "https://joescafe.com/")
    assert.equal(safeBaseUrl("http://localhost:8080/a/b"), "http://localhost:8080/a/b")
  })
  it("rejects everything else", () => {
    for (const value of [undefined, null, 5, "", "//x.example", "javascript:1", "https://u:p@x.example"]) {
      assert.equal(safeBaseUrl(value), null, String(value))
    }
  })
})

describe("pageContentKey: a changed page gets a new frame", () => {
  it("changes when any part of the page changes, and not otherwise", () => {
    const base = pageContentKey(PAGE)
    assert.equal(pageContentKey({ ...PAGE }), base)
    assert.notEqual(pageContentKey({ ...PAGE, html: PAGE.html + " " }), base)
    assert.notEqual(pageContentKey({ ...PAGE, css: PAGE.css + " " }), base)
    assert.notEqual(pageContentKey({ ...PAGE, javascript: PAGE.javascript + " " }), base)
  })

  it("does not confuse content moved between fields", () => {
    assert.notEqual(
      pageContentKey({ html: "ab", css: "c", javascript: "" }),
      pageContentKey({ html: "a", css: "bc", javascript: "" })
    )
  })
})

describe("parseFrameMessage", () => {
  const ok = { source: "siterevive-preview", type: "link", value: "https://other.example/" }

  it("accepts the two message kinds from the page, returning only the type and text", () => {
    assert.deepEqual(parseFrameMessage(ok), { type: "link", value: "https://other.example/" })
    assert.deepEqual(parseFrameMessage({ ...ok, type: "error", value: "x is not defined" }), { type: "error", value: "x is not defined" })
  })

  it("ignores everything else", () => {
    for (const data of [null, "link", 5, [], {}, { ...ok, source: "someone-else" }, { ...ok, type: "navigate" }, { ...ok, type: "eval" }, { ...ok, value: 5 }, { type: "link", value: "x" }]) {
      assert.equal(parseFrameMessage(data), null, JSON.stringify(data))
    }
  })

  it("tidies and limits the text", () => {
    const message = parseFrameMessage({ ...ok, value: `  a\n\tb ${"x".repeat(1000)} ` })
    assert.ok(message && message.value.length <= 300 && !/\n|\t/.test(message.value))
  })
})
