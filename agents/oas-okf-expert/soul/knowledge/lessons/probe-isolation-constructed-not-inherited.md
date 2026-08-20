---
type: Lesson
title: Probe isolation is constructed, not inherited
description: Consumer probes must build their own PATH, HOME, and witnesses so green runs prove the package rather than the developer machine.
tags: [testing, probes, isolation, oas, ci]
timestamp: 2026-08-20
---

A consumer probe that inherits `{ ...process.env }` proves what the laptop had,
not what the package requires. For OAS 0.20, enumerate the system-under-test's
external executable surface first: `git` for git package sources, `npm` for
runtime closure installs, `node` for the CLI shebang, `pi` and `claude` for
runtime launch paths, `tmux` for window creation, and one `which(<cmd>)` per
capability `requires[]` entry.

Then build the environment intentionally:

1. Create a synthetic `bin` and make it the entire `PATH`.
2. Link only the binaries the exercised operations legitimately need, such as
   `node`, `git`, and `npm` for the oas.okf consumer probe.
3. Poison the rest with stubs that record invocation and exit nonzero, so an
   ambient reach fails loudly.
4. Give the run synthetic `HOME` and `TMPDIR`; the kernel walks ancestor configs
   and a developer's home config is real.
5. Neutralize `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM`, so local git identity
   and aliases do not affect kernel clones.

Do not grant access merely because the kernel can call a binary. `cp` is part of
OAS 0.20's local standalone-capability acquisition path, but the oas.okf probe
uses a git source and does not exercise that path. The correct allowlist is the
smallest set required by the operations under test. If a path should be covered,
add an operation that reaches and verifies it; do not widen the allowlist so its
absence stops mattering.

Check both directions. With poisoned stubs present, assert no poisoned binary was
invoked. With the binaries genuinely absent, assert the operation's meaningful
outputs are unchanged. Fetching the released kernel from npm can remain outside
this isolation boundary as setup, but document that exemption explicitly.

Falsify the isolation once by adding a call to a poisoned binary and confirming
the witness assertion fails.

Related: [Falsifiable probe assertions](/lessons/falsifiable-probe-assertions.md) and [Consumer probes use the released CLI and a pinned file:// git source](/decisions/released-cli-pinned-git-consumer-probe.md).
