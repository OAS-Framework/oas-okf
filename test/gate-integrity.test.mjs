// The repository gate must run a KNOWN suite.
//
// Bare `node --test` discovers recursively from the working directory. In a live
// OAS deployment this repository root also holds
// `agents/<soul>/instances/<id>/work/` — full checkouts of this same repository
// belonging to running agent instances — so discovery reaches their `test/`
// directories and the suite the gate reports becomes a function of which agents
// happen to be alive on that machine. A green run then proves nothing
// reproducible, and a stale worktree can fail the gate for code nobody ships.
//
// Detecting that by pattern-matching `node --test` is not enough: `node
// --no-warnings --test` is the same hazard and does not match. So these tests
// tokenize every script and enforce a CANONICAL RUNNER — exactly one Node
// test-runner invocation exists in package.json, it lives in one known script,
// and its file list is exactly the contents of `test/`. Any second invocation,
// however spelled, fails.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts || {};
const CANONICAL_RUNNER_SCRIPT = "test:unit";

/** Split a script into command segments on shell operators, then into tokens.
 * Deliberately simple: this repository's scripts are plain `a && b` chains, and
 * anything more exotic should fail the "one canonical runner" rule anyway. */
const segments = (command) =>
  String(command).split(/&&|\|\||;|\|/).map((part) => part.trim()).filter(Boolean)
    .map((part) => part.split(/\s+/).filter(Boolean));

/** Every Node test-runner invocation in package.json, wherever it appears and
 * however its flags are ordered. `--test` anywhere in Node's option vector is a
 * runner — `node --no-warnings --test` counts. */
function runnerInvocations(from = scripts) {
  const found = [];
  for (const [script, command] of Object.entries(from)) {
    for (const tokens of segments(command)) {
      const [bin, ...rest] = tokens;
      if (basename(bin || "") !== "node") continue;
      if (!rest.includes("--test")) continue;
      found.push({ script, tokens, args: rest.filter((t) => t !== "--test") });
    }
  }
  return found;
}

const expectedFiles = () =>
  readdirSync(join(ROOT, "test")).filter((f) => f.endsWith(".test.mjs")).map((f) => `test/${f}`).sort();

test("exactly one Node test-runner invocation exists, in the canonical script", () => {
  const runners = runnerInvocations();
  assert.equal(runners.length, 1,
    `expected exactly one \`node ... --test\` invocation; found ${runners.length}: ${runners.map((r) => `${r.script}: ${r.tokens.join(" ")}`).join(" | ")}`);
  assert.equal(runners[0].script, CANONICAL_RUNNER_SCRIPT,
    `the runner must live in "${CANONICAL_RUNNER_SCRIPT}", found it in "${runners[0].script}"`);
});

test("the canonical runner names explicit files — no bare discovery, no dirs, no globs", () => {
  const [runner] = runnerInvocations();
  assert.ok(runner, "no runner found");
  const files = runner.args.filter((token) => !token.startsWith("-"));
  assert.ok(files.length > 0, `runner takes no file arguments — bare discovery: ${runner.tokens.join(" ")}`);
  for (const token of files) {
    assert.ok(token.endsWith(".test.mjs"), `runner argument "${token}" is not a .test.mjs file`);
    assert.ok(!/[*?\[\]]/.test(token), `runner argument "${token}" is a glob — globs re-open recursive discovery`);
    assert.ok(token.startsWith("test/"), `runner argument "${token}" is outside test/`);
  }
});

test("the canonical runner's file list is exactly the contents of test/", () => {
  // Closes the failure an explicit list CREATES: a suite that exists but never
  // runs. Compared against this one runner, never a union across scripts — a
  // union lets a safe runner mask an unsafe one.
  const [runner] = runnerInvocations();
  assert.ok(runner, "no runner found");
  const named = [...new Set(runner.args.filter((token) => !token.startsWith("-")))].sort();
  assert.deepEqual(named, expectedFiles(),
    "every file in test/ must be named by the canonical runner, and every named file must exist");
});

test("the aggregate gate delegates to the canonical runner", () => {
  assert.ok(scripts.test, "package.json needs a `test` script");
  const inAggregate = runnerInvocations().filter((r) => r.script === "test");
  assert.equal(inAggregate.length, 0,
    "`test` must delegate to the canonical runner so the file list lives in ONE place");
  assert.match(scripts.test, /npm run validate/, "`test` must run the manifest gate");
  assert.match(scripts.test, new RegExp(`npm run ${CANONICAL_RUNNER_SCRIPT}`), "`test` must run the unit suite");
});

// --- mutation cases -------------------------------------------------------
// The detector is the load-bearing part, so exercise it directly against
// synthetic script maps rather than mutating package.json on disk. Each case is
// a real bypass that a naive `\bnode\s+--test\b` match would let through.
const SAFE = "node --test test/a.test.mjs";
for (const [label, command, expected] of [
  ["flags before --test (bare)", `npm run test:unit && node --no-warnings --test`, 1],
  ["flags between node and --test, with files", `node --no-warnings --test test/a.test.mjs`, 1],
  ["appended bare runner", `${SAFE} && node --test`, 2],
  ["bare runner in an earlier segment", `node --test && ${SAFE}`, 2],
  ["semicolon-separated second runner", `${SAFE} ; node --test`, 2],
  ["piped second runner", `${SAFE} | node --test`, 2],
  ["absolute node path", `/usr/local/bin/node --test`, 1],
  ["single safe runner", SAFE, 1],
]) {
  test(`runner detection: ${label}`, () => {
    const found = runnerInvocations({ "test:unit": command });
    assert.equal(found.length, expected, `detected ${found.length} runner(s) in: ${command}`);
  });
}

test("a runner hidden behind Node flags is detected AND seen as bare", () => {
  // The reported bypass: `node --no-warnings --test` appended to the aggregate.
  // An adjacency match misses it entirely; the detector must both see it and
  // report that it names no files.
  const found = runnerInvocations({ test: "npm run validate && npm run test:unit && node --no-warnings --test" });
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].args.filter((a) => !a.startsWith("-")), [], "it names no files — bare discovery");
  assert.equal(found[0].script, "test", "it lives outside the canonical runner script");
});

test("runner detection ignores non-node commands that mention --test", () => {
  assert.equal(runnerInvocations({ x: "npm run test:unit --test" }).length, 0);
  assert.equal(runnerInvocations({ x: "echo --test" }).length, 0);
});

test("a second runner in ANY script is rejected, not masked by the safe one", () => {
  // The union bug: collecting file names across every script let a compliant
  // `test:unit` satisfy the equality check while another script ran bare
  // discovery. The count rule is per-package.json, so it cannot be masked.
  const found = runnerInvocations({ "test:unit": SAFE, "test:extra": "node --test" });
  assert.equal(found.length, 2);
  assert.ok(found.some((r) => r.args.filter((a) => !a.startsWith("-")).length === 0),
    "the bare invocation must be visible in the detected set");
});
