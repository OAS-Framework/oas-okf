# Decisions

* [Authoring gates are stricter than the kernel reader](authoring-gates-stricter-than-kernel.md) - This repo should reject legacy compatibility shapes that released OAS can still read.
* [Consumer probes use the released CLI and a pinned file:// git source](released-cli-pinned-git-consumer-probe.md) - Release evidence comes from the published kernel installing a tagged git package shape, not a mock or local directory shortcut.
* [Script guards fail closed by allowlisting canonical forms](fail-closed-script-guards.md) - After repeated bypasses, gate scripts by exact known-good forms instead of adding another hazard matcher.
