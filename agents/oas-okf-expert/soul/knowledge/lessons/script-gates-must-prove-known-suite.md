---
type: Lesson
title: Script gates must prove the known suite
description: Repository gates should pin the exact test runner shape and file set instead of relying on recursive discovery or hazard regexes.
tags: [testing, gates, oas, ci, review]
timestamp: 2026-08-20
---

In an OAS repository, bare `node --test` is not a stable gate. The repo root can
contain `agents/<soul>/instances/<id>/work/test/`, and recursive Node test
discovery reaches those live agent worktrees. A green run then depends on which
instances happen to exist on the machine; a stale worktree can fail code nobody
is shipping, or pass code that was never reviewed.

The gate fix is an explicit, canonical runner shape plus a completeness check:

- never run a directory and never run a glob that reopens recursive discovery;
- keep the intended test files in one named runner script;
- assert that the runner's file list equals the current contents of `test/`;
- make the set of script names exact, so an unknown script fails by default.

A sentinel test is useful evidence while debugging: plant a failing test under an
agent worktree and prove that bare `node --test` executes it while the fixed gate
does not. Remove the sentinel after the demonstration; it is not a fixture.

Avoid regex guards for the hazardous spelling. A matcher for `node --test` missed
`node --no-warnings --test`, and broader matchers keep missing other shell forms.
The durable guard is to pin the canonical allowed form and reject everything
else. Count the runners per script map, not a union of all mentioned filenames:
a safe runner elsewhere cannot make an unsafe runner safe.

Test the detector over synthetic script maps rather than by mutating
`package.json` on disk. Synthetic cases are fast, leave no wreckage, and can
cover flags before `--test`, `--test=<x>`, absolute node paths, separators, env
prefixes, and second runners in unexpected scripts.

Related: [Script guards fail closed by allowlisting canonical forms](/decisions/fail-closed-script-guards.md) and [Falsifiable probe assertions](/lessons/falsifiable-probe-assertions.md).
