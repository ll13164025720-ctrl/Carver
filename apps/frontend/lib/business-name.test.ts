import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { deriveBusinessName } from "@/lib/business-name"

describe("deriveBusinessName", () => {
  const cases: Array<[string, unknown, string, string]> = [
    ["drops a generic word before the name", "Home | Joe's Café", "https://joescafe.com/", "Joe's Café"],
    ["drops a generic word after the name", "Joe's Café | Home", "https://joescafe.com/", "Joe's Café"],
    ["prefers the part that matches the domain over a slogan", "Joe's Café - Best Coffee in Portland", "https://joescafe.com/", "Joe's Café"],
    ["finds the name when it comes last", "Best Coffee in Town | Bean There", "https://beanthere.org", "Bean There"],
    ["keeps a title without separators", "Acme Plumbing & Heating", "https://acme.com", "Acme Plumbing & Heating"],
    ["does not split a hyphen inside a word", "Co-op Market", "https://example.org", "Co-op Market"],
    ["splits on an en dash", "Daily bread baked fresh – Mill & Oven", "https://example.org", "Mill & Oven"],
    ["splits on a middle dot and a pipe without spaces", "Daily bread baked fresh·Mill & Oven|Open late every single day", "https://example.org", "Mill & Oven"],
    ["uses the shortest part when none matches the domain", "Quality plumbing for your whole home | Pipes Ltd", "https://example.org", "Pipes Ltd"],
  ]
  for (const [name, title, url, expected] of cases) {
    it(name, () => assert.equal(deriveBusinessName(title, url), expected))
  }

  it("falls back to the domain name when the title is empty or generic", () => {
    assert.equal(deriveBusinessName("", "https://example.com"), "Example")
    assert.equal(deriveBusinessName("Welcome", "https://www.sunrise-bakery.co.uk/"), "Sunrise Bakery")
    assert.equal(deriveBusinessName("Home", "https://www.joes_cafe.com"), "Joes Cafe")
    assert.equal(deriveBusinessName("123", "https://shop.example"), "Shop")
  })

  it("ignores a title that is not a string", () => {
    for (const title of [undefined, null, 5, {}, []]) {
      assert.equal(deriveBusinessName(title, "https://example.com"), "Example")
    }
  })

  it("always returns a usable name", () => {
    assert.equal(deriveBusinessName("", ""), "My Business")
    assert.equal(deriveBusinessName("", "not a url"), "My Business")
    assert.equal(deriveBusinessName("", "http://localhost:3000"), "My Business")
  })

  it("limits the length to what the backend accepts", () => {
    const name = deriveBusinessName("x".repeat(500), "https://example.com")
    assert.ok(name.length > 0 && name.length <= 120)
    const emoji = deriveBusinessName("😀".repeat(300), "https://example.com")
    assert.ok(Array.from(emoji).length <= 120)
  })
})
