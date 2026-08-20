---
type: Lesson
title: Materialized capability assertions include kernel provenance
description: OAS 0.20 materialized capabilities equal authored bytes plus .oas-installation.json, and doctor has a known lock-orphan warning defect.
tags: [oas, packages, materialization, doctor]
timestamp: 2026-08-20
---

An OAS 0.20 materialized capability is not byte-identical to the authored
capability directory. During materialization into
`.agents/capabilities/installed/<id>/`, the kernel writes exactly one provenance
file: `.oas-installation.json`. Assert the installed tree as authored files plus
that file, then assert the provenance fields too: `schemaVersion`, `capability`,
`version`, `package`, `packageVersion`, `source`, `commit`, `packagePath`, and
`capabilityPath`.

For a dedicated non-`.` capability root, the kernel moves the staged directory by
`renameSync`; it does not copy. The legacy `.` root copies because the staged
package root is still needed by later steps.

Released `@oas-framework/oas@0.20.0` also has a confirmed doctor defect. At a
scope where a package-materialized capability is active, `oas doctor <scope>` can
warn that the installed capability has no lock entry even though the lock-v2
`capabilities["<id>"]` row exists and the same doctor run reports the layer's
trust as approved. The warning comes from a legacy acquired-capability reader
that does not consult the lock-v2 capabilities map.

The package should not work around or hide that upstream defect. In probes, prove
the warning premise false by asserting the lock row exists, keep the warning text
as evidence, and let the kernel owners fix doctor. Also remember that the warning
only fires after activation; a probe that stops at install will miss it.

Related: [Consumer probes use the released CLI and a pinned file:// git source](/decisions/released-cli-pinned-git-consumer-probe.md).
