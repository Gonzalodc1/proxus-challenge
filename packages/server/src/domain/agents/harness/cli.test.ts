import { strict as assert } from "node:assert";
import { Effect } from "effect";
import { tokenize } from "./cli.ts";

/**
 * Deterministic tests for the CLI tokenizer. No model, no network, no test
 * framework: the challenge asks not to add frameworks, and `node:assert` is
 * enough to pin down a parser.
 *
 * These exist because of a real failure: the tutor was asked for a Python quiz,
 * built valid JSON, wrapped it in single quotes exactly as its skill instructs,
 * and the harness rejected it with "Unexpected argument: int". The JSON
 * contained `<class 'int'>`, whose apostrophes closed the argument early. The
 * model was right and the scaffolding was wrong.
 */

const run = (input: string) => Effect.runSync(tokenize(input));

let passed = 0;
const check = (name: string, assertion: () => void) => {
  assertion();
  passed++;
  console.log(`  ✓ ${name}`);
};

console.log("harness.cli.tokenize");

check("splits plain arguments", () => {
  assert.deepEqual(run("materials view transpPython 2-4"), ["materials", "view", "transpPython", "2-4"]);
});

check("keeps a single-quoted JSON payload as one token", () => {
  const json = '{"kind":"note","title":"Bucles","markdown":"# Bucles"}';
  assert.deepEqual(run(`artifacts create '${json}'`), ["artifacts", "create", json]);
});

// The regression: apostrophes inside the payload used to close the token early.
check("keeps single quotes that appear inside a single-quoted payload", () => {
  const json = '{"kind":"quiz","options":[{"id":"a","text":"1 y <class \'int\'>"}]}';
  const tokens = run(`artifacts create '${json}'`);
  assert.equal(tokens.length, 3, `expected 3 tokens, got ${tokens.length}: ${JSON.stringify(tokens)}`);
  assert.equal(tokens[2], json);
  assert.ok(JSON.parse(tokens[2] ?? "").options[0].text.includes("'int'"));
});

check("keeps double quotes that appear inside a double-quoted payload", () => {
  const payload = 'he said "hi" twice';
  assert.deepEqual(run(`say "${payload}"`), ["say", payload]);
});

check("still unescapes explicitly escaped quotes", () => {
  assert.deepEqual(run("say 'it\'s fine'"), ["say", "it's fine"]);
});

check("empty input produces no tokens", () => {
  assert.deepEqual(run("   "), []);
});

// Documented trade-off of greedy matching, asserted so it stays visible.
// No command in this CLI takes two separately quoted arguments.
check("documents that two quoted arguments merge into one token", () => {
  assert.deepEqual(run("cmd 'a' 'b'"), ["cmd", "a' 'b"]);
});

console.log(`\n  ${passed} assertions passed`);
