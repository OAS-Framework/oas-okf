---
type: Decision
title: Script guards fail closed by allowlisting canonical forms
description: After repeated bypasses, gate scripts by exact known-good forms instead of adding another hazard matcher.
tags: [testing, gates, security-thinking, decision]
timestamp: 2026-08-20
---

After two reviewed attempts to detect bare `node --test` were bypassed by new
spellings, the oas.okf gate should stop describing the hazard and allowlist the
known-good form instead. A shell has too many ways to spell "run node" for a
matcher to be the durable defense.

The fail-closed policy is:

- the set of `package.json` script names must be exactly the expected set;
- each script must equal its canonical string, derived from disk where a file
  list is involved;
- a deliberately small grammar rejects quotes, parentheses, `$`, backticks,
  semicolons, pipes, and ampersands;
- executables are restricted to bare `npm` or `node`;
- `npm` segments may only be `npm run <known-script>`;
- the Node test runner flag, including `--test=<x>`, is allowed in exactly one
  script and nowhere else.

An allowlist creates friction when scripts legitimately change. That is the
accepted cost for a release gate: a noticed update is safer than an unnoticed
loosening.

Related: [Script gates must prove the known suite](/lessons/script-gates-must-prove-known-suite.md).
