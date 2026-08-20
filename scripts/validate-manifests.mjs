#!/usr/bin/env node
// Repository gate for the DISTRIBUTED oas.okf payload.
//
// The repo root holds dev tooling (scripts/, schemas/, test/); the distributed
// bytes live in `oas-package/`. Manifests and their resources are validated
// against the payload root, never the repo root — repo-only tooling is not
// installed bytes and must never be reachable from a package resource path.
//
// The rules below mirror the RELEASED @oas-framework/oas@0.20.0 contract
// (lib/core.mjs: loadPackageManifestAt, isCanonicalTemplatePath,
// assertCapabilitySelfContained; docs/packages.md). Failing here means the
// released kernel would reject the package at acquisition time, so this gate is
// deliberately at least as strict as the kernel — it also refuses shapes the
// kernel merely tolerates for read compatibility with already-published tags
// (a "." capability root, the deprecated `configs` spelling), because this
// repository is AUTHORING and authoring never emits them.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(repoRoot, "oas-package");
const errors = [];
const report = (path, message) => errors.push(`${path}: ${message}`);
const readJson = (path, at) => {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { report(at ?? relative(root, path), `invalid JSON (${error.message})`); return undefined; }
};
/** A manifest root must be a JSON OBJECT. `null`, scalars and arrays are all
 * valid JSON, and the released loader rejects them explicitly — so they must be
 * reported here rather than falling through as "nothing left to check", which
 * would let an empty or hostile manifest pass the gate. `undefined` means the
 * parse already reported. */
const objectRoot = (value, at) => {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    report(at, `must be a JSON object (got ${value === null ? "null" : Array.isArray(value) ? "array" : typeof value})`);
    return undefined;
  }
  return value;
};

// ---------- JSON Schema subset ----------
// Enough of draft 2020-12 to evaluate the vendored schemas verbatim: local
// $ref/$defs, the combinators the config schema uses, and the string/array/
// object assertions the package and capability schemas use. Returns errors
// rather than reporting them so combinators can evaluate branches silently.
function schemaErrors(value, schema, at, rootSchema) {
  if (schema === true || schema === undefined) return [];
  if (schema === false) return [`${at}: is not allowed here`];
  if (typeof schema !== "object" || schema === null) return [];
  if (typeof schema.$ref === "string") {
    if (!schema.$ref.startsWith("#/")) return [];
    let target = rootSchema;
    for (const segment of schema.$ref.slice(2).split("/")) {
      target = target?.[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
      if (target === undefined) return [`${at}: unresolvable $ref ${schema.$ref}`];
    }
    return schemaErrors(value, target, at, rootSchema);
  }
  const out = [];
  const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  const typeOk = (t) => (t === "integer" ? actual === "number" && Number.isInteger(value) : actual === t);
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(typeOk)) return [`${at}: must be ${types.join(" or ")}, got ${actual}`];
  }
  if ("const" in schema && !Object.is(value, schema.const)) out.push(`${at}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) out.push(`${at}: must be one of ${schema.enum.join(", ")}`);
  if (schema.not && schemaErrors(value, schema.not, at, rootSchema).length === 0) out.push(`${at}: must not match the forbidden shape`);
  for (const branch of schema.allOf || []) out.push(...schemaErrors(value, branch, at, rootSchema));
  if (schema.anyOf && !schema.anyOf.some((branch) => schemaErrors(value, branch, at, rootSchema).length === 0)) out.push(`${at}: matches none of the accepted shapes`);
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((branch) => schemaErrors(value, branch, at, rootSchema).length === 0).length;
    if (matches !== 1) out.push(`${at}: must match exactly one accepted shape (matched ${matches})`);
  }
  if (actual === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) out.push(`${at}: must contain at least ${schema.minLength} character(s)`);
    if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) out.push(`${at}: must match ${schema.pattern}`);
  }
  if (actual === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) out.push(`${at}: must contain at least ${schema.minItems} item(s)`);
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) out.push(`${at}: must contain unique items`);
    if (schema.items) value.forEach((item, index) => out.push(...schemaErrors(item, schema.items, `${at}[${index}]`, rootSchema)));
  }
  if (actual === "object") {
    for (const key of schema.required || []) if (!(key in value)) out.push(`${at}: missing required property ${key}`);
    const properties = schema.properties || {};
    for (const [key, item] of Object.entries(value)) {
      if (schema.propertyNames?.pattern && !(new RegExp(schema.propertyNames.pattern)).test(key)) out.push(`${at}.${key}: property name must match ${schema.propertyNames.pattern}`);
      if (key in properties) out.push(...schemaErrors(item, properties[key], `${at}.${key}`, rootSchema));
      else if (schema.additionalProperties === false) out.push(`${at}.${key}: unknown property`);
      else if (schema.additionalProperties !== undefined) out.push(...schemaErrors(item, schema.additionalProperties, `${at}.${key}`, rootSchema));
    }
  }
  return out;
}
const validateSchema = (value, schema, at) => { if (schema) for (const error of schemaErrors(value, schema, at, schema)) errors.push(error); };

// ---------- oas-config.yaml subset ----------
// Mirrors the released kernel's dependency-free reader (lib/core.mjs
// parseYamlNested/yamlScalar) so a template is validated exactly as the kernel
// will read it, not as a richer YAML library would.
function yamlScalar(raw) {
  const val = raw.trim().replace(/\s+#.*$/, "").trim();
  if (/^(true|false)$/i.test(val)) return val.toLowerCase() === "true";
  if (/^(null|~)$/i.test(val)) return null;
  if (/^-?\d+(\.\d+)?$/.test(val)) return Number(val);
  if (val.startsWith("[") && val.endsWith("]")) return val.slice(1, -1).split(",").map((v) => yamlScalar(v)).filter((v) => v !== "");
  if (val.startsWith("{") && val.endsWith("}")) {
    const out = {};
    for (const part of val.slice(1, -1).split(",")) {
      const i = part.indexOf(":");
      if (i < 0) continue;
      out[part.slice(0, i).trim().replace(/^["']|["']$/g, "")] = yamlScalar(part.slice(i + 1));
    }
    return out;
  }
  return val.replace(/^["']|["']$/g, "");
}
function parseYamlNested(text) {
  const rootNode = {};
  const stack = [{ indent: -1, node: rootNode }];
  for (const raw of text.split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const m = raw.match(/^(\s*)((?:["'][^"']+["'])|(?:[^:#][^:]*?)):\s*(.*?)\s*$/);
    if (!m) continue;
    const [, ws, rawKey, rawVal] = m;
    const key = rawKey.trim().replace(/^["']|["']$/g, "");
    const indent = ws.length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (rawVal.replace(/\s+#.*$/, "").trim() === "" || rawVal.trim().startsWith("#")) {
      const child = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else parent[key] = yamlScalar(rawVal);
  }
  return rootNode;
}

// ---------- containment ----------
const escapes = (base, real) => {
  const fromBase = relative(base, real);
  return fromBase === ".." || fromBase.startsWith(`..${sep}`) || isAbsolute(fromBase);
};

/** Declared path stays inside `base` (a package root or a capability root)
 * after symlink resolution, and exists. Returns the resolved paths, or
 * undefined once it has reported a violation. */
function containedResource(base, candidate, at, kind) {
  if (typeof candidate !== "string" || !candidate.trim()) { report(at, `${kind} must be a non-empty string`); return undefined; }
  if (isAbsolute(candidate) || candidate.split(/[\\/]+/).includes("..")) { report(at, `${kind} must be relative and may not contain '..'`); return undefined; }
  const target = join(base, candidate);
  if (!existsSync(target)) { report(at, `${kind} does not exist: ${candidate}`); return undefined; }
  const realBase = realpathSync(base);
  const real = realpathSync(target);
  if (escapes(realBase, real)) { report(at, `${kind} escapes ${relative(repoRoot, realBase) || "the root"} after symlink resolution`); return undefined; }
  return { path: target, real, realBase };
}

/** Walk a declared directory resource: a descendant symlink may escape the
 * capability root even when the declared root itself does not. Mirrors
 * assertCapabilitySelfContained's walkContained, including its broken-symlink
 * rejection and its visited set (contained link cycles must not loop). */
function walkContained(dir, realBase, at, kind, declared, visited) {
  const realDir = realpathSync(dir);
  if (visited.has(realDir)) return;
  visited.add(realDir);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    let real;
    try { real = realpathSync(child); }
    catch { report(at, `${kind} "${declared}" contains a broken symlink: ${relative(realBase, child)}`); continue; }
    if (escapes(realBase, real)) { report(at, `${kind} "${declared}" contains a path escaping the capability root: ${relative(realBase, child)} -> ${real}`); continue; }
    if (entry.isSymbolicLink()) { if (statSync(real).isDirectory()) walkContained(real, realBase, at, kind, declared, visited); }
    else if (entry.isDirectory()) walkContained(child, realBase, at, kind, declared, visited);
  }
}

/** Reduce a command/hook declaration to its executable entrypoint. A hook may
 * be "entrypoint args" or { command, required }; arguments are opaque. */
const entrypoint = (spec) => {
  const command = typeof spec === "string" ? spec : (spec && typeof spec === "object" ? spec.command : undefined);
  return typeof command === "string" ? command.trim().split(/\s+/)[0] : command;
};

// ---------- template canonicality ----------
// Parity with lib/core.mjs isCanonicalTemplatePath and the JSON-Schema pattern
// it mirrors: under config-templates/, nonempty remainder, no traversal, no
// backslash spelling.
const CANONICAL_TEMPLATE_ROOT = "config-templates/";
function isCanonicalTemplatePath(p) {
  if (typeof p !== "string" || !p.startsWith(CANONICAL_TEMPLATE_ROOT)) return false;
  const rest = p.slice(CANONICAL_TEMPLATE_ROOT.length);
  if (!rest || rest.includes("\\")) return false;
  return !rest.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
}

// Templates are package SOURCE MATERIAL that adopters copy verbatim into their
// own repository, so anything host-, account- or secret-specific in one is a
// portability defect the kernel cannot see.
const UNPORTABLE = [
  [/(^|[\s"'(=:])(\/Users\/|\/home\/|\/root\/|[A-Za-z]:\\)/m, "an absolute machine path"],
  [/\b(api[-_]?key|secret|password|passwd|credential|token)\s*:/im, "a credential-shaped key"],
  [/\b(gh[pousr]_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})\b/, "an embedded secret"],
];

const MINIMUM_FLOOR = [0, 20, 0];
/** Accepted compatibility grammar, exactly: ">=x.y.z", "^x.y.z", or "x.y.z". */
function compatibilityFloor(range) {
  const m = /^(>=|\^)?(\d+)\.(\d+)\.(\d+)$/.exec(String(range ?? ""));
  return m ? [Number(m[2]), Number(m[3]), Number(m[4])] : undefined;
}
const belowMinimum = (floor) => {
  for (let i = 0; i < 3; i += 1) {
    if (floor[i] !== MINIMUM_FLOOR[i]) return floor[i] < MINIMUM_FLOOR[i];
  }
  return false;
};

// ---------- gate ----------
const packagePath = join(root, "oas-package.json");
const packageManifest = existsSync(packagePath)
  ? objectRoot(readJson(packagePath, "oas-package.json"), "oas-package.json")
  : (report("oas-package.json", "distribution manifest is missing"), undefined);
const schemaAt = (name) => objectRoot(readJson(join(repoRoot, "schemas", name), `schemas/${name}`), `schemas/${name}`);
const packageSchema = schemaAt("oas-package.schema.json");
const capabilitySchema = schemaAt("capability-manifest.schema.json");
const configSchema = schemaAt("oas-config.schema.json");

if (packageManifest && packageSchema) validateSchema(packageManifest, packageSchema, "oas-package.json");

// --- capability roots ---
const declaredCapabilities = Array.isArray(packageManifest?.capabilities) ? packageManifest.capabilities : [];
if (packageManifest && !declaredCapabilities.length) {
  report("oas-package.json.capabilities", "every package must export at least one capability — config-only and empty packages are rejected");
}
if (declaredCapabilities.length > 1) {
  report("oas-package.json.capabilities", `official single-capability package must enumerate exactly one capability directory (found ${declaredCapabilities.length})`);
}

const capabilities = [];
for (const [index, capabilityDir] of declaredCapabilities.entries()) {
  const at = `oas-package.json.capabilities[${index}]`;
  if (capabilityDir === ".") {
    report(at, 'the package root "." is not a capability root — authoring must name a DEDICATED root such as "capabilities/<slug>" so the materialized artifact is self-contained ("." survives only as read compatibility for already-published manifests)');
    continue;
  }
  if (!containedResource(root, capabilityDir, at, "capability directory")) continue;
  const manifestPath = join(root, capabilityDir, "oas.json");
  if (!existsSync(manifestPath)) { report(at, `${capabilityDir} has no oas.json (not a capability)`); continue; }
  const manifest = objectRoot(readJson(manifestPath, `${capabilityDir}/oas.json`), `${capabilityDir}/oas.json`);
  if (!manifest) continue;
  capabilities.push({ rel: capabilityDir, dir: dirname(manifestPath), manifest });
  if (capabilitySchema) validateSchema(manifest, capabilitySchema, `${capabilityDir}/oas.json`);

  // Self-containment (contract §2.5): every declared resource must exist and
  // resolve inside its OWN capability root. This is what makes the installed
  // directory independently hashable, restorable and trustable.
  const capabilityRoot = dirname(manifestPath);
  const visited = new Set();
  const declaredResource = (declared, kind, resourceAt, { walk = false, mustBeDirectory = false } = {}) => {
    const resolved = containedResource(capabilityRoot, declared, resourceAt, kind);
    if (!resolved) return;
    const isDirectory = statSync(resolved.real).isDirectory();
    if (mustBeDirectory && !isDirectory) { report(resourceAt, `${kind} "${declared}" is not a directory`); return; }
    if (walk && isDirectory) walkContained(resolved.path, resolved.realBase, resourceAt, kind, declared, visited);
  };
  for (const [i, declared] of (manifest.skills || []).entries()) declaredResource(declared, "skill tree", `${capabilityDir}/oas.json.skills[${i}]`, { walk: true });
  for (const [i, declared] of (manifest.agents || []).entries()) declaredResource(declared, "capability-defined agent", `${capabilityDir}/oas.json.agents[${i}]`, { walk: true, mustBeDirectory: true });
  if (manifest.inject) declaredResource(manifest.inject, "injection", `${capabilityDir}/oas.json.inject`);
  for (const [name, command] of Object.entries(manifest.commands || {})) declaredResource(entrypoint(command), "command entrypoint", `${capabilityDir}/oas.json.commands.${name}`);
  for (const [event, hook] of Object.entries(manifest.hooks || {})) declaredResource(entrypoint(hook), "hook entrypoint", `${capabilityDir}/oas.json.hooks.${event}`);

  for (const forbidden of ["global", "agent-types", "souls"]) {
    if (forbidden in manifest) report(`${capabilityDir}/oas.json.${forbidden}`, "deployment targeting belongs to config, not a capability manifest");
  }
}

// --- config templates ---
if (packageManifest?.configs !== undefined && packageManifest?.configTemplates !== undefined) {
  report("oas-package.json", 'declares both "configTemplates" and the deprecated "configs" spelling — use "configTemplates" only');
}
if (packageManifest?.configs !== undefined) {
  report("oas-package.json.configs", 'the deprecated 0.19 "configs" spelling is readable only for already-published tags — new authoring must emit "configTemplates"');
}
const templates = packageManifest?.configTemplates && typeof packageManifest.configTemplates === "object" && !Array.isArray(packageManifest.configTemplates)
  ? packageManifest.configTemplates
  : {};
if (Object.entries(templates).filter(([, spec]) => spec?.default === true).length > 1) {
  report("oas-package.json.configTemplates", "at most one config template may be marked default");
}
for (const [name, spec] of Object.entries(templates)) {
  const at = `oas-package.json.configTemplates.${name}`;
  if (typeof spec?.path !== "string" || !spec.path) { report(at, "needs a string path"); continue; }
  if (!isCanonicalTemplatePath(spec.path)) {
    report(`${at}.path`, `must live under "${CANONICAL_TEMPLATE_ROOT}" with a contained file path (e.g. "${CANONICAL_TEMPLATE_ROOT}default/oas-config.yaml")`);
    continue;
  }
  const resolved = containedResource(root, spec.path, `${at}.path`, "config template");
  if (!resolved) continue;
  if (!lstatSync(resolved.path).isFile()) { report(`${at}.path`, `config template path is not a file: ${spec.path}`); continue; }

  const text = readFileSync(resolved.path, "utf8");
  for (const [pattern, what] of UNPORTABLE) {
    if (pattern.test(text)) report(`${at}.path`, `template is not portable — it contains ${what}`);
  }
  // A template must be a config the kernel would accept, or adoption fails on
  // the adopter's machine rather than here.
  const config = parseYamlNested(text);
  if (configSchema) validateSchema(config, configSchema, `${spec.path}`);
  // Installation applies no template, so the only capabilities a template may
  // pin to `from: installed` are the ones this package materializes.
  const supplied = new Set(capabilities.map((entry) => entry.manifest?.capability));
  const layers = config?.capabilities?.layers && typeof config.capabilities.layers === "object" ? config.capabilities.layers : {};
  for (const [layer, entry] of Object.entries(layers)) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.from === "installed" && entry.capability && !supplied.has(entry.capability)) {
      report(`${spec.path}.capabilities.layers.${layer}`, `binds "${entry.capability}" with from: installed, but this package materializes no such capability`);
    }
    const provider = capabilities.find((c) => c.manifest?.capability === entry.capability);
    if (provider && provider.manifest.layer !== layer) {
      report(`${spec.path}.capabilities.layers.${layer}`, `binds "${entry.capability}", whose manifest declares layer "${provider.manifest.layer}"`);
    }
  }
}

// --- package/capability agreement ---
if (capabilities.length === 1 && packageManifest) {
  const capability = capabilities[0].manifest;
  if (packageManifest.package !== capability.capability) report("oas-package.json.package", "single-capability official package ID must equal its capability ID");
  if (packageManifest.version !== capability.version) report("oas-package.json.version", "must match the exported capability version");
  if (packageManifest.compatibility?.oas !== capability.compatibility?.oas) report("oas-package.json.compatibility.oas", "must match the exported capability compatibility floor");
}
for (const [at, range] of [
  ["oas-package.json.compatibility.oas", packageManifest?.compatibility?.oas],
  ...capabilities.map((entry) => [`${entry.rel}/oas.json.compatibility.oas`, entry.manifest?.compatibility?.oas]),
]) {
  if (range === undefined) continue;
  const floor = compatibilityFloor(range);
  if (!floor) { report(at, `malformed range ${JSON.stringify(range)} — accepted grammar exactly: >=x.y.z, ^x.y.z, or x.y.z`); continue; }
  // The materialization contract this payload is authored against exists only
  // from 0.20.0; a lower floor would promise 0.19 hosts a package they cannot
  // install.
  if (belowMinimum(floor)) report(at, `floor ${range} is below the materialization contract this package requires (>=${MINIMUM_FLOOR.join(".")})`);
}

if (errors.length) {
  process.stderr.write(`Manifest validation failed:\n- ${errors.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write(`Validated ${relative(process.cwd(), packagePath) || "oas-package.json"}, ${capabilities.length} capability manifest(s) and ${Object.keys(templates).length} config template(s).\n`);
