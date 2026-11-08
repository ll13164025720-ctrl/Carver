import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import { describe, it } from "node:test"

import { sha256, sha256Base64 } from "@/lib/sha256"

const reference = (text: string) => createHash("sha256").update(text, "utf8").digest("base64")

describe("sha256Base64 matches Node's SHA-256", () => {
  it("known test vectors (FIPS 180-4)", () => {
    const hex = (text: string) => Buffer.from(sha256(text)).toString("hex")
    assert.equal(hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    assert.equal(hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    assert.equal(
      hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    )
  })

  it("every length around the padding boundaries (0 to 200 bytes)", () => {
    for (let length = 0; length <= 200; length += 1) {
      const text = "x".repeat(length)
      assert.equal(sha256Base64(text), reference(text), `length ${length}`)
    }
  })

  it("multi-byte text: accents, CJK, emoji, a lone surrogate", () => {
    for (const text of ["café", "日本語のテキスト", "emoji 😀🎉", "mixed é日😀", "\u2028\u2029", "lone \ud800 surrogate"]) {
      assert.equal(sha256Base64(text), reference(text), text)
    }
  })

  it("random strings of many sizes", () => {
    for (let i = 0; i < 200; i += 1) {
      const text = randomBytes(Math.floor(Math.random() * 3000)).toString("latin1")
      assert.equal(sha256Base64(text), reference(text))
    }
  })

  it("large inputs (like a page's CSS or JavaScript)", () => {
    for (const size of [10_000, 40_000, 120_000, 200_000]) {
      const text = "body{margin:0;font:16px/1.4 system-ui}\n".repeat(Math.ceil(size / 39)).slice(0, size)
      assert.equal(sha256Base64(text), reference(text), String(size))
    }
  })

  it("output is 44 base64 characters with padding", () => {
    assert.match(sha256Base64("anything"), /^[A-Za-z0-9+/]{43}=$/)
  })
})
