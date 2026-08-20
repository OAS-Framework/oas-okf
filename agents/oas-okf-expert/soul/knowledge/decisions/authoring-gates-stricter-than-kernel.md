---
type: Decision
title: Authoring gates are stricter than the kernel reader
description: This repo should reject legacy compatibility shapes that released OAS can still read.
tags: [oas, packages, validation, decision]
timestamp: 2026-08-20
---

`scripts/validate-manifests.mjs` deliberately rejects shapes that released OAS
0.20.0 `loadPackageManifestAt` still accepts for read compatibility:

- a `"."` capability root when the manifest has no `configTemplates`;
- the deprecated `configs` template spelling.

Read compatibility exists because published tags are immutable. That rationale
does not apply in an authoring repository: unpublished package manifests can and
should be rewritten into the durable shape before release. A gate that merely
matches the kernel reader would let this repo author the legacy shapes the
contract is trying to retire.

The discriminator is counter-intuitive: the kernel treats a manifest as the new
format, and therefore forbids `"."`, when `configTemplates` is present. It is not
keyed only on the absence of deprecated `configs`, because already-published
packages exist with a `"."` root and neither template spelling.

The authoring gate also checks properties the kernel cannot infer at read time:

- template portability, rejecting local absolute paths or secrets in a template
  that will be copied verbatim into someone else's scope;
- `from: installed` closure, requiring templates to pin only capabilities the
  package actually materializes, and into the layer each capability manifest
  declares.

Related: [Manifest validation needs hostile-root and asymmetric-resource cases](/lessons/manifest-validation-edge-cases.md).
