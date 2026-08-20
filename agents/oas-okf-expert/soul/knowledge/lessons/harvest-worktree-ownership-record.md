---
type: Lesson
title: Harvest work-tree ownership comes from recorded work mode
description: Attached harvests must use the kernel's recorded owner instead of inferring ownership from the work symlink.
tags: [oas, okf, harvest, attached, checkout]
timestamp: 2026-08-20
---

`oas okf harvest` must not claim the source instance as parent merely because it
is harvesting that source's notes. In attached work mode, the source instance is
a guest in another instance's tree, and the kernel requires attached agents to be
children of the work-tree owner. Passing `--parent <source>` for an attached
source names the wrong parent and the kernel rejects the spawn.

Do not infer ownership from disk shape. In `lib/core.mjs`, worktree mode uses a
real directory, but checkout, workspace, and attached modes all expose
`<home>/work` as a symlink. A symlink test would misclassify checkout and
workspace instances as guests and break the default case.

Use the fact the kernel already recorded:

- if the source's recorded work mode (`OAS_WORK` / `meta.work`) is `attached`,
  anchor the harvester to the recorded owner (`parentInstance`) when present;
- for any other recorded work mode, the source owns its tree and is the anchor;
- if an attached source has no recorded owner, pass no invented lineage and let
  the kernel infer or fail explicitly.

A deployment still running oas.okf versions with the old parent choice fails
softly: notes remain on disk. Diagnose the version actually running from `oas
doctor .`, which names the materialized artifact path, and from that artifact's
`oas.json`, not from the version in the current work tree.
