---
type: Lesson
title: OAS CLI probe surface gotchas
description: oas doctor uses a positional directory, oas create needs an agents root, and git check-ignore exit 1 is a normal negative answer.
tags: [oas, cli, testing, probes]
timestamp: 2026-08-20
---

Three small CLI details can make a consumer probe test the wrong thing:

- `oas doctor` takes a positional directory: `oas doctor <dir> [--soul <name>]`.
  It does not use `--dir` like `oas install`, `oas trust`, or `oas config diff`.
  Passing `--dir <scope>` can leave doctor resolving from the process CWD, so
  assertions describe the wrong scope.
- `oas create <name>` needs an existing `agents/` or `local-agents/` directory
  somewhere up the tree, unless `PI_AGENTS_ROOT` points at one. A fresh scope
  with adopted config still needs `mkdir agents` before composition tests create
  a soul.
- `git check-ignore -q <path>` exits 1 to mean "not ignored". A shell helper
  that treats every nonzero status as command failure aborts on a normal negative
  answer.

Keep these details close to probe code because they fail quietly: the command may
still run, but against the wrong directory or with the wrong interpretation.

Related: [Consumer probes use the released CLI and a pinned file:// git source](/decisions/released-cli-pinned-git-consumer-probe.md).
