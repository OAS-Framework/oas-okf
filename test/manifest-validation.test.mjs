// Negative gate coverage for scripts/validate-manifests.mjs against the
// RELEASED @oas-framework/oas@0.20.0 package contract. Each case starts from a
// COMPLETE, VALID fixture package and introduces exactly one defect, so a
// failure names the rule under test rather than fixture noise.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SCHEMAS = ["oas-package.schema.json", "capability-manifest.schema.json", "oas-config.schema.json"];

const VALID_TEMPLATE = `# Fixture reference configuration.
name: fixture-deployment

capabilities:
  layers:
    knowledge:
      capability: fixture.knowledge
      from: installed
      global: true
`;

/** A valid single-capability fixture package, mutated by `mutate` before the
 * gate runs. `mutate` receives the manifests and the fixture paths; returning
 * nothing keeps the baseline. */
function runFixture(t, mutate = () => {}) {
  const fixture = mkdtempSync(join(tmpdir(), "oas-manifest-negative-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const payload = join(fixture, "oas-package");
  const capabilityDir = join(payload, "capabilities", "fixture-knowledge");
  mkdirSync(join(fixture, "scripts"), { recursive: true });
  mkdirSync(join(fixture, "schemas"), { recursive: true });
  mkdirSync(join(capabilityDir, "bin"), { recursive: true });
  mkdirSync(join(capabilityDir, "skills", "fixture"), { recursive: true });
  mkdirSync(join(capabilityDir, "injects"), { recursive: true });
  mkdirSync(join(payload, "config-templates", "default"), { recursive: true });
  copyFileSync(join(ROOT, "scripts", "validate-manifests.mjs"), join(fixture, "scripts", "validate-manifests.mjs"));
  for (const schema of SCHEMAS) copyFileSync(join(ROOT, "schemas", schema), join(fixture, "schemas", schema));

  writeFileSync(join(capabilityDir, "bin", "fixture.mjs"), "#!/usr/bin/env node\n");
  writeFileSync(join(capabilityDir, "skills", "fixture", "SKILL.md"), "# fixture skill\n");
  writeFileSync(join(capabilityDir, "injects", "fixture.md"), "fixture injection\n");
  // A package-only file: reachable from the package root but NOT from the
  // capability root, so a capability that reaches it is not self-contained.
  writeFileSync(join(payload, "PACKAGE-ONLY.md"), "package-level file\n");

  const packageManifest = {
    package: "fixture.knowledge",
    version: "2.0.0",
    description: "Negative manifest-validation fixture.",
    compatibility: { oas: ">=0.20.0" },
    capabilities: ["capabilities/fixture-knowledge"],
    configTemplates: { default: { path: "config-templates/default/oas-config.yaml", description: "Fixture template.", default: true } },
  };
  const capabilityManifest = {
    capability: "fixture.knowledge",
    version: "2.0.0",
    compatibility: { oas: ">=0.20.0" },
    layer: "knowledge",
    description: "Negative manifest-validation fixture capability.",
    requires: [],
    skills: ["skills"],
    inject: "injects/fixture.md",
    commands: { run: "bin/fixture.mjs run" },
  };
  const templates = { "config-templates/default/oas-config.yaml": VALID_TEMPLATE };

  // A mutation may return { packageJson, capabilityJson } to write RAW bytes
  // instead of the serialized object — the only way to express a manifest that
  // is valid JSON but not a JSON object.
  const raw = mutate({ packageManifest, capabilityManifest, templates, fixture, payload, capabilityDir }) || {};

  writeFileSync(join(payload, "oas-package.json"),
    raw.packageJson !== undefined ? raw.packageJson : JSON.stringify(packageManifest, null, 2) + "\n");
  writeFileSync(join(capabilityDir, "oas.json"),
    raw.capabilityJson !== undefined ? raw.capabilityJson : JSON.stringify(capabilityManifest, null, 2) + "\n");
  for (const [rel, body] of Object.entries(templates)) {
    const path = join(payload, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }

  return spawnSync(process.execPath, [join(fixture, "scripts", "validate-manifests.mjs")], { cwd: fixture, encoding: "utf8" });
}

/** Add a second, otherwise-valid capability root to the fixture package. */
function addCapability(payload, slug, id) {
  const dir = join(payload, "capabilities", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "oas.json"), JSON.stringify({
    capability: id, version: "2.0.0", compatibility: { oas: ">=0.20.0" },
    description: "Second fixture capability.", requires: [],
  }, null, 2) + "\n");
  return `capabilities/${slug}`;
}

test("the baseline fixture passes the gate", (t) => {
  const result = runFixture(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 capability manifest\(s\) and 1 config template\(s\)/);
});

test("gate rejects a non-object package manifest root", (t) => {
  // null, scalars and arrays are all valid JSON. Treating them as "nothing left
  // to check" let an empty manifest pass the gate while the released loader
  // rejects them outright.
  for (const [label, body] of [["null", "null"], ["number", "42"], ["string", '"nope"'], ["array", "[]"]]) {
    const result = runFixture(t, () => ({ packageJson: body + "\n" }));
    assert.equal(result.status, 1, `${label} root must fail (stdout: ${result.stdout})`);
    assert.match(result.stderr, new RegExp(`oas-package\\.json: must be a JSON object \\(got ${label}\\)`));
  }
});

test("gate rejects a non-object capability manifest root", (t) => {
  const result = runFixture(t, () => ({ capabilityJson: "null\n" }));
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /oas\.json: must be a JSON object \(got null\)/);
});

test("gate rejects an unparseable manifest", (t) => {
  const result = runFixture(t, () => ({ packageJson: "{ not json\n" }));
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /invalid JSON/);
});

test("gate rejects a package that exports no capability", (t) => {
  const result = runFixture(t, ({ packageManifest }) => { delete packageManifest.capabilities; });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /every package must export at least one capability/);
});

test("gate rejects extra capability enumerations", (t) => {
  const result = runFixture(t, ({ packageManifest, payload }) => {
    packageManifest.capabilities.push(addCapability(payload, "fixture-second", "fixture.second"));
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must enumerate exactly one capability directory \(found 2\)/);
});

test('gate rejects the package root "." as a capability root', (t) => {
  const result = runFixture(t, ({ packageManifest }) => { packageManifest.capabilities = ["."]; });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /is not a capability root — authoring must name a DEDICATED root/);
});

test("gate rejects a capability root that escapes the package after symlink resolution", (t) => {
  const result = runFixture(t, ({ packageManifest, fixture, payload }) => {
    mkdirSync(join(fixture, "outside", "capability"), { recursive: true });
    writeFileSync(join(fixture, "outside", "capability", "oas.json"), "{}\n");
    symlinkSync(join(fixture, "outside", "capability"), join(payload, "capabilities", "escaped"));
    packageManifest.capabilities = ["capabilities/escaped"];
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /capability directory escapes .* after symlink resolution/);
});

test("gate rejects both template spellings on one manifest", (t) => {
  const result = runFixture(t, ({ packageManifest }) => {
    packageManifest.configs = { legacy: { path: "config-templates/default/oas-config.yaml" } };
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /declares both "configTemplates" and the deprecated "configs" spelling/);
});

test("gate rejects the deprecated configs spelling in new authoring", (t) => {
  const result = runFixture(t, ({ packageManifest }) => {
    packageManifest.configs = packageManifest.configTemplates;
    delete packageManifest.configTemplates;
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /new authoring must emit "configTemplates"/);
});

test("gate rejects a template outside the canonical config-templates root", (t) => {
  const result = runFixture(t, ({ packageManifest, templates }) => {
    packageManifest.configTemplates.default.path = "templates/default/oas-config.yaml";
    templates["templates/default/oas-config.yaml"] = VALID_TEMPLATE;
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must live under "config-templates\/" with a contained file path/);
});

test("gate rejects more than one default template", (t) => {
  const result = runFixture(t, ({ packageManifest, templates }) => {
    packageManifest.configTemplates.second = { path: "config-templates/second/oas-config.yaml", default: true };
    templates["config-templates/second/oas-config.yaml"] = VALID_TEMPLATE;
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /at most one config template may be marked default/);
});

test("gate rejects an unportable template carrying a machine path", (t) => {
  const result = runFixture(t, ({ templates }) => {
    templates["config-templates/default/oas-config.yaml"] = VALID_TEMPLATE + "\ntemplates:\n  local: /Users/someone/oas-config.yaml\n";
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /template is not portable — it contains an absolute machine path/);
});

test("gate rejects an unportable template carrying a credential-shaped key", (t) => {
  const result = runFixture(t, ({ templates }) => {
    templates["config-templates/default/oas-config.yaml"] = VALID_TEMPLATE.replace(
      "      global: true\n",
      "      global: true\n      settings:\n        api_key: abcdef0123456789\n",
    );
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /template is not portable — it contains a credential-shaped key/);
});

test("gate rejects a template that is not a valid config", (t) => {
  const result = runFixture(t, ({ templates }) => {
    templates["config-templates/default/oas-config.yaml"] = VALID_TEMPLATE + "\nunknown-top-level: value\n";
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown property/);
});

test("gate rejects a template pinning from: installed to a capability the package does not ship", (t) => {
  const result = runFixture(t, ({ templates }) => {
    templates["config-templates/default/oas-config.yaml"] = VALID_TEMPLATE.replace("fixture.knowledge", "other.knowledge");
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /binds "other\.knowledge" with from: installed, but this package materializes no such capability/);
});

test("gate rejects a template binding a capability into the wrong layer", (t) => {
  const result = runFixture(t, ({ templates }) => {
    templates["config-templates/default/oas-config.yaml"] = VALID_TEMPLATE.replace("    knowledge:", "    tasks:");
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /binds "fixture\.knowledge", whose manifest declares layer "knowledge"/);
});

test("gate rejects a capability declaring a resource it does not carry", (t) => {
  const result = runFixture(t, ({ capabilityManifest }) => { capabilityManifest.inject = "injects/missing.md"; });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /injection does not exist: injects\/missing\.md/);
});

test("gate rejects a capability whose declared resource leaves its own root", (t) => {
  const result = runFixture(t, ({ capabilityManifest, capabilityDir, payload }) => {
    symlinkSync(join(payload, "PACKAGE-ONLY.md"), join(capabilityDir, "injects", "package-only.md"));
    capabilityManifest.inject = "injects/package-only.md";
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /injection escapes .* after symlink resolution/);
});

test("gate rejects a declared skill tree containing an escaping descendant symlink", (t) => {
  const result = runFixture(t, ({ capabilityDir, payload }) => {
    symlinkSync(join(payload, "PACKAGE-ONLY.md"), join(capabilityDir, "skills", "fixture", "reaches-out.md"));
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /skill tree "skills" contains a path escaping the capability root/);
});

test("gate rejects a declared skill tree containing a broken symlink", (t) => {
  const result = runFixture(t, ({ capabilityDir }) => {
    symlinkSync(join(capabilityDir, "skills", "fixture", "absent.md"), join(capabilityDir, "skills", "fixture", "dangling.md"));
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /skill tree "skills" contains a broken symlink/);
});

test("gate rejects a command entrypoint outside the capability root", (t) => {
  const result = runFixture(t, ({ capabilityManifest }) => { capabilityManifest.commands = { run: "../fixture-second/bin/fixture.mjs run" }; });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /command entrypoint must be relative and may not contain '\.\.'/);
});

test("gate rejects deployment targeting inside a capability manifest", (t) => {
  const result = runFixture(t, ({ capabilityManifest }) => { capabilityManifest.global = true; });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /deployment targeting belongs to config, not a capability manifest/);
});

test("gate rejects a compatibility floor below the materialization contract", (t) => {
  const result = runFixture(t, ({ packageManifest, capabilityManifest }) => {
    packageManifest.compatibility.oas = ">=0.19.0";
    capabilityManifest.compatibility.oas = ">=0.19.0";
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /floor >=0\.19\.0 is below the materialization contract this package requires \(>=0\.20\.0\)/);
});

test("gate rejects a malformed compatibility range", (t) => {
  const result = runFixture(t, ({ packageManifest, capabilityManifest }) => {
    packageManifest.compatibility.oas = ">0.20";
    capabilityManifest.compatibility.oas = ">0.20";
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /accepted grammar exactly: >=x\.y\.z, \^x\.y\.z, or x\.y\.z/);
});

test("gate rejects package/capability version drift", (t) => {
  const result = runFixture(t, ({ packageManifest }) => { packageManifest.version = "2.1.0"; });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must match the exported capability version/);
});

test("gate rejects package/capability identity drift", (t) => {
  const result = runFixture(t, ({ packageManifest }) => { packageManifest.package = "fixture.other"; });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /official package ID must equal its capability ID/);
});
