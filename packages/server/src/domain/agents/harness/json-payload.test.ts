import { strict as assert } from "node:assert";
import { repairInvalidQuoteEscapes } from "./json-payload.ts";

/**
 * Deterministic tests for the JSON repair applied to artifact payloads.
 *
 * These come from a real failure: asked for a Python quiz, the tutor wrote a
 * question containing `<class 'int'>` and escaped the apostrophes. JSON has no
 * escape for a single quote, so parsing died on content that was otherwise
 * correct and the agent spent extra steps retrying.
 */

let passed = 0;
const check = (name: string, assertion: () => void) => {
  assertion();
  passed++;
  console.log(`  ✓ ${name}`);
};

console.log("harness.json-payload.repairInvalidQuoteEscapes");

check("leaves valid JSON untouched", () => {
  const json = '{"kind":"note","title":"Bucles","markdown":"# Bucles"}';
  assert.equal(repairInvalidQuoteEscapes(json), json);
});

// The regression: an escaped apostrophe is not legal JSON, so it is rewritten.
check("repairs an escaped single quote so the payload parses", () => {
  const broken = '{"text":"<class \\\'int\\\'>"}';
  assert.throws(() => JSON.parse(broken));

  const repaired = repairInvalidQuoteEscapes(broken);
  assert.equal(JSON.parse(repaired).text, "<class 'int'>");
});

check("keeps escaped double quotes working", () => {
  const json = '{"text":"dijo \\"hola\\""}';
  assert.equal(JSON.parse(repairInvalidQuoteEscapes(json)).text, 'dijo "hola"');
});

check("does not corrupt an escaped backslash before a quote", () => {
  // JSON source for a value that is a literal backslash followed by a quote.
  const json = '{"text":"ruta\\\\\\" fin"}';
  const expected = JSON.parse(json).text;
  assert.equal(JSON.parse(repairInvalidQuoteEscapes(json)).text, expected);
});

check("repairs several escaped apostrophes in one payload", () => {
  const broken = '{"a":"<class \\\'int\\\'>","b":"<class \\\'float\\\'>"}';
  const parsed = JSON.parse(repairInvalidQuoteEscapes(broken));
  assert.equal(parsed.a, "<class 'int'>");
  assert.equal(parsed.b, "<class 'float'>");
});

console.log(`\n  ${passed} assertions passed`);
