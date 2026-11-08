/**
 * Remove inline event handler attributes (onclick, onload, ...) from
 * AI-generated HTML.
 *
 * The prompt forbids them, but the model occasionally adds one (for example an
 * onclick on a promotion button). Rejecting the whole page after a 1-2 minute
 * generation for that is wasteful, so the attributes are dropped instead.
 *
 * This only ever removes markup. GeneratedWebsiteSchema still runs afterwards
 * with its strict whole-string check, so anything this tokenizer misses is
 * still rejected rather than served.
 */
export function stripInlineEventHandlers(html: string): {
  html: string;
  removed: number;
} {
  let output = "";
  let removed = 0;
  let i = 0;
  const length = html.length;

  const isSpace = (character: string) => /\s/.test(character);

  while (i < length) {
    const character = html[i];

    // Only start tags ("<" followed by a letter) carry attributes.
    if (character !== "<" || !/[a-z]/i.test(html[i + 1] ?? "")) {
      output += character;
      i += 1;
      continue;
    }

    // Copy "<" and the tag name.
    let tagStart = i + 1;
    while (tagStart < length && !isSpace(html[tagStart]) && html[tagStart] !== ">" && html[tagStart] !== "/") {
      tagStart += 1;
    }
    output += html.slice(i, tagStart);
    i = tagStart;

    // Walk the attributes until the tag closes.
    while (i < length && html[i] !== ">") {
      if (isSpace(html[i]) || html[i] === "/") {
        // Browsers treat "/" between attributes like whitespace.
        output += html[i];
        i += 1;
        continue;
      }

      const attributeStart = i;

      while (i < length && !isSpace(html[i]) && !"=>/".includes(html[i])) {
        i += 1;
      }

      if (i === attributeStart) {
        // A stray character such as "=" with no name; copy it and move on.
        output += html[i];
        i += 1;
        continue;
      }

      const name = html.slice(attributeStart, i);

      // Optional "= value", with or without quotes.
      let lookahead = i;
      while (lookahead < length && isSpace(html[lookahead])) lookahead += 1;

      if (html[lookahead] === "=") {
        lookahead += 1;
        while (lookahead < length && isSpace(html[lookahead])) lookahead += 1;

        const quote = html[lookahead];
        if (quote === '"' || quote === "'") {
          const closing = html.indexOf(quote, lookahead + 1);
          lookahead = closing === -1 ? length : closing + 1;
        } else {
          while (lookahead < length && !isSpace(html[lookahead]) && html[lookahead] !== ">") {
            lookahead += 1;
          }
        }
        i = lookahead;
      }

      if (/^on/i.test(name)) {
        removed += 1;
      } else {
        output += html.slice(attributeStart, i);
      }
    }

    if (i < length) {
      output += ">";
      i += 1;
    }
  }

  return { html: output, removed };
}

/**
 * Apply stripInlineEventHandlers to a raw model response before schema
 * validation. Non-object responses are returned unchanged.
 */
export function withoutInlineEventHandlers(generated: unknown): unknown {
  if (
    !generated ||
    typeof generated !== "object" ||
    typeof (generated as { html?: unknown }).html !== "string"
  ) {
    return generated;
  }

  const result = stripInlineEventHandlers((generated as { html: string }).html);

  if (result.removed > 0) {
    console.warn(
      `Removed ${result.removed} inline event handler attribute(s) from generated HTML`,
    );
  }

  return { ...(generated as object), html: result.html };
}
