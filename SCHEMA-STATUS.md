# Schema status

- **Vendored schemas verified against the public release**: `schemas/oas-package.schema.json`,
  `schemas/capability-manifest.schema.json`, `schemas/oas-lock.schema.json`, and
  `schemas/oas-config.schema.json` are byte-identical to `docs/` in the published
  `@oas-framework/oas@0.20.0` npm tarball (tag `v0.20.0@1e73257da9ee03a9d9a18a93fe5f410f9d22bc18`).
  `scripts/validate-manifests.mjs` validates the package manifest, the capability
  manifest, and the shipped config template against them on every run.
- **Repository gate mirrors the released contract**: dedicated capability roots
  (never `.`), per-capability self-containment including descendant-symlink walks,
  the canonical `configTemplates` spelling, the canonical `config-templates/`
  template location, template portability and config validity, and the `>=0.20.0`
  compatibility floor. Parity is kept with `lib/core.mjs`
  (`loadPackageManifestAt`, `isCanonicalTemplatePath`, `assertCapabilitySelfContained`).
- **Consumer probe CLOSED against the released kernel**: `scripts/consumer-probe.mjs`
  runs the published 0.20.0 CLI outside this source tree and proves git acquisition
  with a contained package root, flat materialization, transport-only package lock
  rows, per-artifact capability rows, no trust at acquisition, generated-store
  ignore behavior, the separate trust gate, exact restore, explicit template
  adoption with a recorded adopted base, and composition into a soul's final
  `AGENTS.md`. This supersedes the previous
  `TODO(engine-consumer-fixtures)` hold, which was open only because no released
  0.19 fixtures existed.
- **Runtime boundary final**: harvest requires the dispatcher's canonical absolute
  `OAS_CLI_BIN`, invokes it with argv-safe `execFile`, parses schema-v1 envelopes,
  reads dispatch settings, uses a capability-defined agent, and cleans mode-0600
  task files. It never searches `PATH` or imports/discovers kernel files.

## Known released-kernel defect (not a package defect)

Against released 0.20.0, `oas doctor` at a scope where `oas.okf` is ACTIVE prints:

```text
WARNING: oas.okf at <scope>/.agents/capabilities/installed/oas.okf is in installed/ but has no lock entry — reacquire it or move it to owned/
```

The premise is false: the scope's `oas-lock.json` carries the `capabilities["oas.okf"]`
row with its own path and integrity, and the same doctor run resolves the knowledge
layer and reports `trust: approved`. The legacy acquired-capability reader does not
consult the lock-v2 `capabilities` map. Per the final-v2 maintainer ruling this is a
kernel defect to be fixed upstream; the package carries **no workaround**, and the
probe asserts the lock row exists and preserves the warning text verbatim as evidence.
