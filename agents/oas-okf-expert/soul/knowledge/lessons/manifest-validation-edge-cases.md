---
type: Lesson
title: Manifest validation needs hostile-root and asymmetric-resource cases
description: Authoring validators must reject valid-JSON non-objects and preserve the kernel's different rules for skills[] and agents[].
tags: [validation, json, gates, packages]
timestamp: 2026-08-20
---

`JSON.parse` accepts more than objects. `null`, numbers, strings, and arrays are
valid JSON; if the validator guards checks with truthiness, `null` can skip every
rule and exit 0. Distinguish three states explicitly:

- parse failure already reported;
- parsed value is absent because of that failure;
- parsed value is present but not a plain object, which is its own validation
  error.

The same rule applies to schema files: a schema that parses to `null` must fail
loudly, not silently disable validation.

Capability self-containment has an asymmetric OAS 0.20 rule that deserves tests:
`skills[]` entries may be a single file or a directory, while `agents[]` entries
must resolve to a directory. Both sides stat the realpath; a symlink to a
directory satisfies `agents[]`. After the directory check, `agents[]` is walked
unconditionally, while `skills[]` is walked only in the directory branch.

A validator can implement this correctly and still lose it in the next refactor
if the branch is unexercised. Keep three fixture cases together:

1. a valid capability-defined agent directory;
2. a file under `agents[]`, rejected;
3. a file under `skills[]`, accepted as the control against over-correction.

Then falsify by collapsing the two resource kinds in the validator and confirming
only the new parity test goes red.

Related: [Authoring gates are stricter than the kernel reader](/decisions/authoring-gates-stricter-than-kernel.md) and [Falsifiable probe assertions](/lessons/falsifiable-probe-assertions.md).
