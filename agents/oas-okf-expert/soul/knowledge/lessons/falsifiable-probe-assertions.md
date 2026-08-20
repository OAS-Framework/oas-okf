---
type: Lesson
title: Falsifiable probe assertions
description: Probe assertions only count when the harness can observe them and a deliberate break makes them fail.
tags: [testing, probes, rigor, harness]
timestamp: 2026-08-20
---

A counted check is evidence only if it can fail for the defect it claims to catch.
Several oas.okf v2 probe reviews found checks that looked like coverage but were
true by construction:

- asserting `status === 0` after a helper that already exits on nonzero status;
- comparing file names when the claim was byte identity;
- comparing two `stderr` strings that a helper hardcoded to `""` on success;
- checking a witness log after the witness stubs were removed;
- comparing A/B runs that started from different state and performed different
  operations.

Treat command success as either a prerequisite or an assertion, not both. If the
status is counted, run the command through a helper that can return failure and
then guard reads that depend on success. When the claim is about bytes, hash the
bytes and guard the vacuous case (`files.length > 0`).

Before strengthening a suspicious assertion, ask whether the harness can observe
the value at all. `execFileSync` with piped stderr still does not return stderr
on success; use `spawnSync` when a test reasons about successful stderr, and map
`status: null` or signals to explicit failures. Add harness self-checks for the
capabilities downstream tests depend on, such as "stderr is captured for exit 0"
and "a missing binary is reported as failure".

For A/B comparisons, one helper should reset the state, run the same operation,
and return the same observations from both arms. Compare the returned status,
artifact bytes, lock bytes, doctor status, and doctor JSON. Each arm may assert
only what it can observe: a poisoned-stub witness log is meaningful while stubs
exist, and meaningless after they are absent.

The cheap falsifier is mandatory: deliberately break the thing the check claims
to guard and confirm the check goes red. If no deliberate break can make it fail,
it is decoration, not evidence.

Related: [Probe isolation is constructed, not inherited](/lessons/probe-isolation-constructed-not-inherited.md) and [Consumer probes use the released CLI and a pinned file:// git source](/decisions/released-cli-pinned-git-consumer-probe.md).
