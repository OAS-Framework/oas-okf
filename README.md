# oas-okf

Official [OAS](https://github.com/OAS-Framework/oas) knowledge-layer integration for [Open Knowledge Format](https://github.com/google/open-knowledge). It provides:

- idempotent soul scaffolding for an OKF knowledge bundle;
- per-instance `STATE.md`, `log.md`, and `notes/` continuity;
- the `okf` and `memory-harvest` skills plus a zero-dependency validator;
- `oas okf harvest`, which launches an ephemeral harvester to promote pending notes; and
- lifecycle instructions that keep the kernel memory-format agnostic.

## Requirements

The capability has no external host-command requirement. It requires OAS `>=0.20.0`, the release whose materialization contract projects each exported capability into a self-contained `.agents/capabilities/installed/<id>/` artifact and whose frozen package-runtime boundary provides schema-v1 `oas spawn ... --json` envelopes and capability-defined agents.

The harvest command invokes only that structured CLI boundary through the absolute `OAS_CLI_BIN` supplied by dispatch and argv-safe `execFile`. It never searches `PATH`, discovers the kernel root, or imports private kernel files. [`KERNEL-API-NEEDS.md`](KERNEL-API-NEEDS.md) records the now-satisfied historical inventory.

## What the package ships

```text
oas-package/                                     # the distributed payload, and only it
  oas-package.json                               # package 2.0.0, compatibility >=0.20.0
  capabilities/oas-okf/                          # the DEDICATED capability root
    oas.json  agents/  bin/  injects/  skills/   # everything the capability declares
  config-templates/default/oas-config.yaml       # a reference config; never applied by install
  LICENSE
```

The capability root is dedicated and self-contained: every declared skill, injection, agent, command, and hook resolves inside it, with no symlinks and no reach into package-only paths. That is what lets the kernel hash, restore, and trust the installed artifact on its own.

## Acquire, trust, and activate

Installing materializes the capability. It grants no trust and applies no config:

```bash
oas install oas.okf --dir /path/to/scope          # after the catalog entry exists
oas trust oas.okf --dir /path/to/scope            # approve the executable surface
oas use oas.okf --global --dir /path/to/scope     # activate it deliberately
oas doctor /path/to/scope --soul <soul-name>
```

A pinned Git source works before catalog publication:

```bash
oas install git:https://github.com/OAS-Framework/oas-okf.git@<tag> --dir /path/to/scope
```

## Adopting the config template

`config-templates/default/oas-config.yaml` is a complete reference configuration that binds `oas.okf` to the knowledge layer. It is package **source material**, not installed policy — `oas install` applies none of it. Adoption is always explicit and always separate:

```bash
oas init --package oas.okf --config default --dir /path/to/scope   # new scope
oas config adopt oas.okf --config default --dir /path/to/scope     # rebase an existing scope
```

Adoption also records the exact template bytes as the adopted base under `.agents/config-templates/adopted/oas.okf/default/`, which `oas config diff` and `oas config sync` compare against. Commit that base with your config. Everything adopted becomes ordinary local policy: retarget the layer, disable it, or replace the provider — a package update never rewrites an adopted config.

## Use

Spawned instances receive the selected OKF skills and instructions automatically. They keep `STATE.md` current, append milestones to `log.md`, capture learned concepts in `notes/`, and after committing run:

```bash
oas okf harvest
```

The command skips safely when there are no pending notes or when a harvester for the source instance is already running. Otherwise it resolves the packaged `memory-harvest` capability agent and spawns through `oas spawn --json`; task instructions use mode-0600 temporary files removed on every outcome.

## Development

```bash
npm test     # manifest gate + unit tests
npm run probe   # isolated consumer probe against the released 0.20.0 CLI
```

`npm test` runs [`scripts/validate-manifests.mjs`](scripts/validate-manifests.mjs), the repository gate that mirrors the released 0.20.0 package contract — dedicated capability roots, per-capability self-containment, the canonical `configTemplates` spelling and location, template portability and config validity, and the compatibility floor — then the unit tests for that gate and for the capability's own lifecycle behavior.

`npm run probe` runs [`scripts/consumer-probe.mjs`](scripts/consumer-probe.mjs), which installs the released `@oas-framework/oas@0.20.0` into a scratch prefix, publishes this payload as a pinned Git source, and proves through the real CLI, outside this source tree: git acquisition with a contained package root, flat materialization, transport-only package lock rows, per-artifact capability lock rows, no trust at acquisition, generated-store ignore behavior, the separate trust gate, exact restore, explicit template adoption with a recorded adopted base, and composition into a soul's final `AGENTS.md`. Set `OAS_PROBE_CLI` to an existing released binary to skip the download; the probe refuses any kernel that is not 0.20.0.

Both gates run in CI on every pull request. [`SCHEMA-STATUS.md`](SCHEMA-STATUS.md) records the vendored-schema provenance and the probe's standing.
