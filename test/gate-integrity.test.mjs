// The repository gate must run a KNOWN suite.
//
// Bare `node --test` discovers recursively from the working directory. In a live
// OAS deployment this repository root also holds
// `agents/<soul>/instances/<id>/work/` — full checkouts of this same repository
// belonging to running agent instances — so discovery reaches their `test/`
// directories and the reported suite becomes a function of which agents happen
// to be alive on that machine.
//
// Two earlier versions of this guard tried to DESCRIBE the hazard — first
// `node --test` as an adjacency, then a tokenizer looking for `--test` in the
// option vector. Both were bypassable, because there is no end to the ways a
// shell can spell "run node": `FOO=1 node --test`, `env FOO=1 node --test`,
// `(node --test)`, `npx node --test`, `$NODE --test`, `"node" --test`, and
// Node 22's own `node --test=foo`.
//
// So this guard does not describe the hazard. It FAILS CLOSED: package.json's
// scripts must be exactly the known set, spelled exactly the known way, using
// only a tiny permitted grammar. Anything else — an unknown script, unsupported
// shell syntax, a second runner however spelled — is a violation by default,
// with no pattern to slip past.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts || {};
const RUNNER_SCRIPT = "test:unit";

const expectedFiles = () =>
  readdirSync(join(ROOT, "test")).filter((f) => f.endsWith(".test.mjs")).map((f) => `test/${f}`).sort();

/** The only scripts this repository may declare, and their exact spelling. */
const canonicalScripts = () => ({
  validate: "node scripts/validate-manifests.mjs",
  [RUNNER_SCRIPT]: `node --test ${expectedFiles().join(" ")}`,
  probe: "node scripts/consumer-probe.mjs",
  test: "npm run validate && npm run test:unit",
});

// Conservative: ordinary path/flag characters and spaces only. Anything that can
// introduce a command — quotes, parens, $, backticks, ;, |, redirection, globs —
// is unsupported syntax, not something to parse.
const SAFE_CHARS = /^[A-Za-z0-9_@:./=-]+$/;

/** Fail-closed structural check over a scripts map. Returns human-readable
 * violations; an empty array means the map is in the permitted grammar. */
export function violations(map) {
  const found = [];
  const known = new Set(Object.keys(map));
  for (const [name, raw] of Object.entries(map)) {
    const command = String(raw);
    if (command.includes("&&&") || /(^|[^&])&($|[^&])/.test(command)) {
      found.push(`${name}: backgrounding or malformed '&'`);
      continue;
    }
    for (const segment of command.split("&&")) {
      const tokens = segment.trim().split(/\s+/).filter(Boolean);
      if (!tokens.length) { found.push(`${name}: empty command segment`); continue; }
      for (const token of tokens) {
        if (!SAFE_CHARS.test(token)) { found.push(`${name}: unsupported shell syntax in "${token}"`); }
      }
      const [bin, ...rest] = tokens;
      // The executable must be a bare `npm` or `node` — never an env
      // assignment, a wrapper, a variable, or a quoted spelling.
      if (bin !== "npm" && bin !== "node") {
        found.push(`${name}: segment must start with npm or node, got "${bin}"`);
        continue;
      }
      // `--test` in ANY form, including `--test=<x>`, may appear only in the one
      // canonical runner script.
      const carriesRunner = rest.some((t) => t === "--test" || t.startsWith("--test="));
      if (carriesRunner && name !== RUNNER_SCRIPT) {
        found.push(`${name}: only "${RUNNER_SCRIPT}" may invoke the Node test runner`);
      }
      if (bin === "npm") {
        if (rest[0] !== "run" || rest.length !== 2) found.push(`${name}: npm segments must be exactly "npm run <script>"`);
        else if (!known.has(rest[1])) found.push(`${name}: runs unknown script "${rest[1]}"`);
      } else if (carriesRunner) {
        if (!rest.includes("--test")) found.push(`${name}: runner must use "--test", not "--test=<x>"`);
        const files = rest.filter((t) => t !== "--test");
        if (!files.length) found.push(`${name}: bare \`node --test\` — recursive discovery`);
        for (const f of files) {
          if (!f.startsWith("test/") || !f.endsWith(".test.mjs")) found.push(`${name}: runner argument "${f}" is not a test/*.test.mjs file`);
        }
      } else if (rest.length !== 1 || !rest[0].endsWith(".mjs")) {
        found.push(`${name}: node segments must name exactly one .mjs script`);
      }
    }
  }
  return found;
}

test("package.json declares exactly the known scripts", () => {
  assert.deepEqual(Object.keys(scripts).sort(), Object.keys(canonicalScripts()).sort(),
    "an unknown script is a violation by default — this is what makes the guard fail closed");
});

test("every script is spelled exactly the canonical way", () => {
  assert.deepEqual(scripts, canonicalScripts());
});

test("the runner's file list is exactly the contents of test/", () => {
  // Closes the failure an explicit list CREATES: a suite that exists but never
  // runs. Derived from disk, so a new test file fails the gate until registered.
  const named = (scripts[RUNNER_SCRIPT] || "").split(/\s+/).filter((t) => t.endsWith(".test.mjs")).sort();
  assert.deepEqual(named, expectedFiles());
});

test("the real manifest is inside the permitted grammar", () => {
  assert.deepEqual(violations(scripts), []);
});

// --- mutation cases -------------------------------------------------------
// Every spelling that defeated the previous tokenizer, plus the forms that
// defeated the one before it. Exercised against the checker directly, so they
// stay fast and leave package.json untouched.
const BASE = { validate: "node scripts/validate-manifests.mjs", [RUNNER_SCRIPT]: "node --test test/a.test.mjs", probe: "node scripts/consumer-probe.mjs", test: "npm run validate && npm run test:unit" };
for (const [label, bypass] of [
  ["env assignment prefix", "FOO=1 node --test"],
  ["env wrapper", "env FOO=1 node --test"],
  ["subshell parentheses", "(node --test)"],
  ["--test= form", "node --test=foo"],
  ["npx wrapper", "npx node --test"],
  ["quoted executable", '"node" --test'],
  ["variable executable", "$NODE --test"],
  ["command substitution", "$(which node) --test"],
  ["semicolon chain", "node scripts/validate-manifests.mjs ; node --test"],
  ["pipe chain", "node scripts/validate-manifests.mjs | node --test"],
  ["backgrounded", "node --test &"],
  ["plain bare runner", "node --test"],
  ["absolute node path", "/usr/local/bin/node --test"],
]) {
  test(`rejected as an extra script: ${label}`, () => {
    const problems = violations({ ...BASE, "test:bypass": bypass });
    assert.ok(problems.length > 0, `"${bypass}" produced no violation`);
  });
  test(`rejected when appended to the aggregate: ${label}`, () => {
    const problems = violations({ ...BASE, test: `npm run validate && npm run test:unit && ${bypass}` });
    assert.ok(problems.length > 0, `"${bypass}" produced no violation when chained into \`test\``);
  });
}

test("an unknown script name alone is a violation, whatever it runs", () => {
  // The outermost defense: even a perfectly innocent extra script fails, so no
  // new spelling has to be anticipated.
  assert.deepEqual(Object.keys({ ...scripts, "test:bypass": "node --test" }).sort(),
    [...Object.keys(canonicalScripts()), "test:bypass"].sort());
  assert.notDeepEqual(Object.keys({ ...scripts, "test:bypass": "node --test" }).sort(), Object.keys(canonicalScripts()).sort());
});

test("a compliant runner cannot mask a second one", () => {
  const problems = violations({ ...BASE, test: "npm run validate && npm run test:unit && node --test" });
  assert.ok(problems.some((p) => /bare|only "test:unit"/.test(p)), problems.join("; "));
});

test("the permitted grammar still accepts the canonical manifest shape", () => {
  assert.deepEqual(violations(BASE), []);
});
