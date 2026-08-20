// The repository gate must run a KNOWN suite.
//
// Bare `node --test` discovers recursively from the working directory. In a live
// OAS deployment this repository root also holds
// `agents/<soul>/instances/<id>/work/` — full checkouts of this same repository
// belonging to running agent instances. Bare discovery therefore reaches their
// `test/` directories, and the suite the gate reports becomes a function of
// which instances happen to exist on that machine: a green run proves nothing
// reproducible, and a stale worktree can fail (or silently pass) the gate for
// code nobody is shipping.
//
// So every runner names its files explicitly. These tests keep that property
// from regressing, and — because an explicit list introduces the opposite
// failure, a new test file nobody registered — assert the list stays complete.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts || {};
const TEST_RUNNER = /\bnode\s+--test\b/;
/** The argument tail of every `node --test` invocation in a script. */
const runnerTails = (command) =>
  command.split("&&").map((part) => part.trim()).filter((part) => TEST_RUNNER.test(part))
    .map((part) => part.replace(/^.*?\bnode\s+--test\b/, "").trim());

test("no script invokes bare `node --test`", () => {
  for (const [name, command] of Object.entries(scripts)) {
    for (const tail of runnerTails(command)) {
      const files = tail.split(/\s+/).filter((token) => token.endsWith(".test.mjs"));
      assert.notEqual(tail, "", `script "${name}" runs bare \`node --test\` — it would discover instance worktrees`);
      assert.ok(files.length > 0, `script "${name}" runs \`node --test\` without naming any .test.mjs file: ${command}`);
    }
  }
});

test("every test runner names explicit files, never a directory or glob", () => {
  for (const [name, command] of Object.entries(scripts)) {
    for (const tail of runnerTails(command)) {
      for (const token of tail.split(/\s+/).filter(Boolean)) {
        if (token.startsWith("--")) continue;
        assert.ok(token.endsWith(".test.mjs"), `script "${name}" passes non-file argument "${token}" to node --test`);
        assert.ok(!/[*?]/.test(token), `script "${name}" passes a glob "${token}" — globs re-open recursive discovery`);
        assert.ok(token.startsWith("test/"), `script "${name}" names "${token}" outside test/`);
      }
    }
  }
});

test("the named suite is exactly the contents of test/", () => {
  // The risk an explicit list creates: a test file that exists but is never run.
  const onDisk = readdirSync(join(ROOT, "test")).filter((f) => f.endsWith(".test.mjs")).map((f) => `test/${f}`).sort();
  const named = [...new Set(
    Object.values(scripts).flatMap(runnerTails)
      .flatMap((tail) => tail.split(/\s+/).filter((token) => token.endsWith(".test.mjs"))),
  )].sort();
  assert.deepEqual(named, onDisk, "every file in test/ must be named by a runner, and every named file must exist");
});

test("the aggregate gate delegates instead of running the runner itself", () => {
  assert.ok(scripts.test, "package.json needs a `test` script");
  assert.ok(!TEST_RUNNER.test(scripts.test),
    "`test` must delegate to a named runner (npm run test:unit) so the file list lives in ONE place");
  assert.match(scripts.test, /npm run validate/, "`test` must run the manifest gate");
  assert.match(scripts.test, /npm run test:unit/, "`test` must run the unit suite");
});
