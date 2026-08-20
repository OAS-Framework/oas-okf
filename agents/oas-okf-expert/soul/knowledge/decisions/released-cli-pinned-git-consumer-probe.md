---
type: Decision
title: Consumer probes use the released CLI and a pinned file:// git source
description: Release evidence comes from the published kernel installing a tagged git package shape, not a mock or local directory shortcut.
tags: [oas, packages, testing, ci, decision]
timestamp: 2026-08-20
---

`scripts/consumer-probe.mjs` should install the real released kernel,
`@oas-framework/oas@0.20.0`, into a scratch prefix, refuse any other kernel
version, publish the payload into a temporary git repository, tag it, and acquire
it as `file://<repo>@<tag>#oas-package`.

That shape is intentional:

- The manifest gate proves the authored files say the right things. The consumer
  probe proves the kernel consumers actually run agrees with those files.
- A `file://` source is classified by OAS as `kind: "git"`, so the probe covers
  clone, pinned-ref checkout, and fragment-contained package root selection
  without network dependency on GitHub.
- A local path install would skip the catalog-like git source shape, and an
  unpinned git source would not lock the provenance a real install uses.

The probe must cover the full consumer lifecycle in order: acquisition, flat
materialization, transport-only package lock row versus per-artifact capability
row, no trust at acquisition, generated-store ignore, separate trust gate, exact
restore, explicit adoption with recorded adopted base, and composition into a
soul's `AGENTS.md`. Stopping before activation misses defects such as doctor's
known materialized-capability lock warning.

Related: [Materialized capability assertions include kernel provenance](/lessons/materialized-capability-provenance.md), [Probe isolation is constructed, not inherited](/lessons/probe-isolation-constructed-not-inherited.md), and [OAS CLI probe surface gotchas](/lessons/oas-cli-probe-gotchas.md).
