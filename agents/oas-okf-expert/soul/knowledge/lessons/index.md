# Lessons

* [Falsifiable probe assertions](falsifiable-probe-assertions.md) - Probe assertions only count when the harness can observe them and a deliberate break makes them fail.
* [Script gates must prove the known suite](script-gates-must-prove-known-suite.md) - Repository gates should pin the exact test runner shape and file set instead of relying on recursive discovery or hazard regexes.
* [Probe isolation is constructed, not inherited](probe-isolation-constructed-not-inherited.md) - Consumer probes must build their own PATH, HOME, and witnesses so green runs prove the package rather than the developer machine.
* [Manifest validation needs hostile-root and asymmetric-resource cases](manifest-validation-edge-cases.md) - Authoring validators must reject valid-JSON non-objects and preserve the kernel's different rules for skills[] and agents[].
* [Materialized capability assertions include kernel provenance](materialized-capability-provenance.md) - OAS 0.20 materialized capabilities equal authored bytes plus .oas-installation.json, and doctor has a known lock-orphan warning defect.
* [Harvest work-tree ownership comes from recorded work mode](harvest-worktree-ownership-record.md) - Attached harvests must use the kernel's recorded owner instead of inferring ownership from the work symlink.
* [OAS CLI probe surface gotchas](oas-cli-probe-gotchas.md) - oas doctor uses a positional directory, oas create needs an agents root, and git check-ignore exit 1 is a normal negative answer.
