---
name: oas-package-release-probes
description: >-
  Use when creating, repairing, or reviewing an OAS package release gate or
  consumer probe: manifest validation, script/test gates, released-CLI consumer
  evidence, capability materialization, trust/restore/adoption/composition
  probes, or isolation from the developer machine.
---

# OAS package release probes

Build release evidence from the consumer's point of view, then make every check
falsifiable.

## Procedure

1. **Use the released kernel, not the work tree.** Install the target
   `@oas-framework/oas` version into a scratch prefix and fail if the CLI version
   is not the one the release claims to support. For oas.okf v2 this was
   `@oas-framework/oas@0.20.0`.
2. **Publish the payload as a pinned git source.** Put the package payload in a
   temporary git repo, tag it, and acquire `file://<repo>@<tag>#oas-package`.
   This exercises clone, pinned checkout, and fragment-contained root selection
   without depending on GitHub.
3. **Drive the full lifecycle.** Cover acquisition, materialization, package lock
   row vs capability lock row, no trust at acquisition, generated-store ignore,
   separate trust, exact restore, config adoption with recorded base, and
   composition into a soul's `AGENTS.md`. Do not stop before activation.
4. **Construct the probe environment.** Give kernel invocations a synthetic
   `PATH`, `HOME`, and `TMPDIR`. Link only the binaries the exercised path needs;
   poison all other known kernel-surface binaries with witness stubs; neutralize
   global/system git config.
5. **Check both isolation directions.** With poisoned stubs present, assert no
   stub was invoked. With those binaries absent, assert status and durable outputs
   match the poisoned run. Only assert witness logs in the poisoned arm.
6. **Make the repository gate fail closed.** Explicitly enumerate test files;
   assert the list equals the contents of `test/`; allowlist canonical script
   names and command strings instead of matching hazardous spellings.
7. **Test validator edge cases.** Include valid-JSON non-objects, schema
   non-objects, and the asymmetric `skills[]` file vs `agents[]` directory cases.
8. **Falsify each important assertion once.** Break the claimed property and
   verify the check goes red. Harness capabilities that other assertions depend
   on deserve their own self-checks.

## Gotchas

- `oas doctor` takes a positional directory (`oas doctor <dir>`), unlike several
  commands that accept `--dir`.
- `oas create <name>` needs an existing `agents/` or `local-agents/` root unless
  `PI_AGENTS_ROOT` is set.
- `git check-ignore -q` exits 1 for a normal "not ignored" result.
- OAS 0.20 materializes `.oas-installation.json` inside installed capabilities;
  installed bytes equal authored bytes plus that provenance file.
- Released OAS 0.20 doctor can falsely warn that an active materialized
  capability has no lock entry. Assert the lock-v2 capability row exists and keep
  the warning as upstream-defect evidence; do not hide it in package code.
- Do not grant a binary because the kernel can call it. Grant it only if this
  probe's operation requires it.

## References

- [Consumer probes use the released CLI and a pinned file:// git source](../../knowledge/decisions/released-cli-pinned-git-consumer-probe.md)
- [Probe isolation is constructed, not inherited](../../knowledge/lessons/probe-isolation-constructed-not-inherited.md)
- [Script gates must prove the known suite](../../knowledge/lessons/script-gates-must-prove-known-suite.md)
- [Falsifiable probe assertions](../../knowledge/lessons/falsifiable-probe-assertions.md)
- [Manifest validation needs hostile-root and asymmetric-resource cases](../../knowledge/lessons/manifest-validation-edge-cases.md)
