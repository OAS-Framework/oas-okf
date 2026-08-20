#!/usr/bin/env node
// Isolated consumer probe: exercise the DISTRIBUTED oas.okf payload through the
// RELEASED @oas-framework/oas@0.20.0 CLI, from outside this source tree.
//
// The repository gate (scripts/validate-manifests.mjs) proves the manifests are
// what the contract describes. This proves the released kernel AGREES — that a
// real consumer, given only the published bytes, gets a flat self-contained
// artifact, an exact restore, an honest trust gate, an explicit and recorded
// adoption, a clean generated store, and a capability that actually composes
// into an agent's instructions.
//
//   node scripts/consumer-probe.mjs [--keep]
//
// The kernel is installed from npm into a scratch prefix. Set OAS_PROBE_CLI to
// an existing released `oas` binary to skip that download; the probe refuses a
// binary whose `oas version` is not 0.20.0, because a probe against the wrong
// kernel proves nothing.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_KERNEL = "0.20.0";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const payload = join(repoRoot, "oas-package");
const keep = process.argv.includes("--keep");

let checks = 0;
const failures = [];
const check = (label, condition, detail = "") => {
  checks += 1;
  if (condition) process.stdout.write(`  ok ${String(checks).padStart(2, " ")}  ${label}\n`);
  else { failures.push(label); process.stdout.write(`  FAIL ${String(checks).padStart(2, " ")}  ${label}${detail ? `\n        ${detail}` : ""}\n`); }
};
const section = (title) => process.stdout.write(`\n${title}\n`);

const probeRoot = mkdtempSync(join(tmpdir(), "oas-okf-consumer-probe-"));
process.on("exit", () => { if (!keep) rmSync(probeRoot, { recursive: true, force: true }); });

function sh(command, args, { cwd = probeRoot, env = {}, allowFailure = false } = {}) {
  try {
    const stdout = execFileSync(command, args, {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      // A probe must not inherit this machine's OAS state, editor, or pager.
      env: { ...process.env, OAS_NO_LAUNCH: "1", GIT_TERMINAL_PROMPT: "0", ...env },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    if (!allowFailure) {
      process.stderr.write(`\nprobe command failed: ${command} ${args.join(" ")}\n${error.stdout || ""}\n${error.stderr || ""}\n`);
      process.exit(1);
    }
    return { status: error.status ?? 1, stdout: error.stdout || "", stderr: error.stderr || "" };
  }
}
const git = (cwd, ...args) => sh("git", args, { cwd });
// `git check-ignore` exits 1 to mean "not ignored" — a normal answer, not a failure.
const gitIgnores = (cwd, path) => sh("git", ["check-ignore", "-q", path], { cwd, allowFailure: true }).status === 0;

// ---------- released kernel ----------
section("Released kernel");
let cli = process.env.OAS_PROBE_CLI;
if (!cli) {
  const prefix = join(probeRoot, "kernel");
  mkdirSync(prefix, { recursive: true });
  writeFileSync(join(prefix, "package.json"), JSON.stringify({ name: "oas-okf-probe-host", private: true, version: "0.0.0" }) + "\n");
  sh("npm", ["install", `@oas-framework/oas@${REQUIRED_KERNEL}`, "--no-audit", "--no-fund", "--loglevel", "error"], { cwd: prefix });
  cli = join(prefix, "node_modules", ".bin", "oas");
}
const kernelVersion = sh(cli, ["version"]).stdout.trim();
check(`released CLI is @oas-framework/oas@${REQUIRED_KERNEL}`, kernelVersion.includes(REQUIRED_KERNEL), `got ${JSON.stringify(kernelVersion)}`);
if (!kernelVersion.includes(REQUIRED_KERNEL)) { process.stderr.write("refusing to probe against a non-0.20.0 kernel\n"); process.exit(1); }
const oas = (args, opts = {}) => sh(cli, args, opts);

// ---------- publish the payload as a git package source ----------
section("Package source (git, pinned ref, contained package root)");
const sourceRepo = join(probeRoot, "oas-okf-source");
mkdirSync(sourceRepo, { recursive: true });
cpSync(payload, join(sourceRepo, "oas-package"), { recursive: true, verbatimSymlinks: true });
// A repo-only file at the source root: nothing outside the selected package
// root may reach the consumer.
writeFileSync(join(sourceRepo, "REPO-ONLY.md"), "repository tooling, never distributed\n");
git(sourceRepo, "init", "-q", "-b", "main");
git(sourceRepo, "config", "user.email", "probe@example.invalid");
git(sourceRepo, "config", "user.name", "oas.okf consumer probe");
git(sourceRepo, "add", "-A");
git(sourceRepo, "commit", "-q", "-m", "probe: publish oas.okf payload");
git(sourceRepo, "tag", "probe-v2.0.0");
const sourceCommit = git(sourceRepo, "rev-parse", "HEAD").stdout.trim();
const sourceUrl = `file://${sourceRepo}`;
const sourceSpec = `${sourceUrl}@probe-v2.0.0#oas-package`;
check("payload published at a pinned tag", /^[0-9a-f]{40}$/.test(sourceCommit), sourceCommit);

const template = readFileSync(join(payload, "config-templates", "default", "oas-config.yaml"), "utf8");
const capabilityRoot = join(payload, "capabilities", "oas-okf");

// ---------- scope A: acquisition, materialization, ignore, trust, restore ----------
const scopeA = join(probeRoot, "consumer");
mkdirSync(scopeA, { recursive: true });
git(scopeA, "init", "-q", "-b", "main");
git(scopeA, "config", "user.email", "probe@example.invalid");
git(scopeA, "config", "user.name", "oas.okf consumer probe");

section("Acquisition and flat materialization");
const install = oas(["install", sourceSpec, "--dir", scopeA, "--no-requirements", "--json"]);
check("`oas install <git source>` succeeds", install.status === 0, install.stderr);

const lockPath = join(scopeA, "oas-lock.json");
const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : {};
const packageRow = lock.packages?.["oas.okf"] || {};
const capabilityRow = lock.capabilities?.["oas.okf"] || {};
check("lock is lockfileVersion 2", lock.lockfileVersion === 2, String(lock.lockfileVersion));
check("package row records the exact git source", packageRow.source === `git:${sourceUrl}@probe-v2.0.0`, packageRow.source);
check("package row records the exact commit", packageRow.commit === sourceCommit, packageRow.commit);
check("package row records the selected contained root", packageRow.path === "oas-package", packageRow.path);
check("package row carries payload integrity", /^sha256-/.test(packageRow.integrity || ""), packageRow.integrity);
check("package row is TRANSPORT only (no trust, no capability list)",
  !("trusted" in packageRow) && !("capabilities" in packageRow), JSON.stringify(Object.keys(packageRow)));
check("capability row records version, provider and dedicated root",
  capabilityRow.version === "2.0.0" && capabilityRow.package === "oas.okf" && capabilityRow.path === "capabilities/oas-okf",
  JSON.stringify(capabilityRow));
check("capability row carries its OWN artifact integrity",
  /^sha256-/.test(capabilityRow.integrity || "") && capabilityRow.integrity !== packageRow.integrity, capabilityRow.integrity);
check("acquisition grants NO executable trust", capabilityRow.trusted === false, String(capabilityRow.trusted));

const installedDir = join(scopeA, ".agents", "capabilities", "installed", "oas.okf");
check("capability materialized at .agents/capabilities/installed/oas.okf", existsSync(installedDir));

/** Every file under `dir`, plus any symlink it contains. A materialized
 * artifact must be a plain tree: the kernel resolves symlinks away so the
 * installed directory is independently hashable. */
function walk(dir) {
  const files = [];
  const symlinks = [];
  const recurse = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const rel = relative(dir, path);
      if (entry.isSymbolicLink()) { symlinks.push(rel); continue; }
      if (entry.isDirectory()) { recurse(path); continue; }
      files.push(rel);
    }
  };
  if (existsSync(dir)) recurse(dir);
  return { files: files.sort(), symlinks: symlinks.sort() };
}

const materialized = walk(installedDir);
const authored = walk(capabilityRoot);
check("materialized artifact is FLAT — it contains no symlinks", materialized.symlinks.length === 0, materialized.symlinks.join(", "));
// The kernel writes exactly one file of its own into the artifact: the
// `.oas-installation.json` provenance record. Anything else appearing here
// would mean the materialized bytes are not the authored bytes.
const PROVENANCE = ".oas-installation.json";
check("materialized artifact is the authored capability plus only the kernel's provenance record",
  JSON.stringify(materialized.files) === JSON.stringify([...authored.files, PROVENANCE].sort()),
  `installed=${materialized.files.join(",")} authored=${authored.files.join(",")}`);
const provenance = existsSync(join(installedDir, PROVENANCE)) ? JSON.parse(readFileSync(join(installedDir, PROVENANCE), "utf8")) : {};
check("the provenance record names this capability, package, commit and dedicated root",
  provenance.capability === "oas.okf" && provenance.version === "2.0.0"
  && provenance.package === "oas.okf" && provenance.packageVersion === "2.0.0"
  && provenance.commit === sourceCommit
  && provenance.packagePath === "oas-package" && provenance.capabilityPath === "capabilities/oas-okf",
  JSON.stringify(provenance));
const installedManifest = existsSync(join(installedDir, "oas.json")) ? JSON.parse(readFileSync(join(installedDir, "oas.json"), "utf8")) : {};
check("materialized oas.json preserves capability identity, layer and version",
  installedManifest.capability === "oas.okf" && installedManifest.layer === "knowledge" && installedManifest.version === "2.0.0",
  JSON.stringify({ capability: installedManifest.capability, layer: installedManifest.layer, version: installedManifest.version }));
check("nothing outside the selected package root reached the consumer",
  !existsSync(join(installedDir, "REPO-ONLY.md")) && !existsSync(join(scopeA, "REPO-ONLY.md")));
check("installing applies NO config template", !existsSync(join(scopeA, "oas-config.yaml")));
check("installing records NO adopted base", !existsSync(join(scopeA, ".agents", "config-templates")));

section("Generated-store ignore behavior");
const capabilityIgnore = join(scopeA, ".agents", "capabilities", ".gitignore");
const ignoreText = existsSync(capabilityIgnore) ? readFileSync(capabilityIgnore, "utf8") : "";
check(".agents/capabilities/.gitignore exists", existsSync(capabilityIgnore));
check("it ignores installed/ only",
  /(^|\n)\s*installed\/?\s*(\n|$)/.test(ignoreText) && !/owned/.test(ignoreText) && !/config-templates/.test(ignoreText),
  JSON.stringify(ignoreText));
check("the materialized artifact IS ignored", gitIgnores(scopeA, relative(scopeA, installedDir)));
const status = git(scopeA, "status", "--porcelain").stdout;
check("git status shows no path under installed/", !/capabilities\/installed\//.test(status), status.trim());
check("the lock itself is NOT ignored (it is committed provenance)", !gitIgnores(scopeA, "oas-lock.json"));

section("Trust is a separate, per-artifact gate");
const doctorBefore = oas(["doctor", scopeA, "--json"], { allowFailure: true });
check("doctor reports the untrusted executable surface before trust",
  /untrusted/i.test(doctorBefore.stdout + doctorBefore.stderr), doctorBefore.stdout.slice(0, 200));
const trust = oas(["trust", "oas.okf", "--dir", scopeA], { allowFailure: true });
check("`oas trust oas.okf` succeeds", trust.status === 0, trust.stderr);
const lockAfterTrust = JSON.parse(readFileSync(lockPath, "utf8"));
check("trust binds to the capability artifact", lockAfterTrust.capabilities["oas.okf"].trusted === true);
check("trust does not create a package-level approval", !("trusted" in lockAfterTrust.packages["oas.okf"]));
check("trust does not change the artifact integrity",
  lockAfterTrust.capabilities["oas.okf"].integrity === capabilityRow.integrity);

section("Exact restore");
const lockBeforeRestore = readFileSync(lockPath, "utf8");
rmSync(installedDir, { recursive: true, force: true });
check("the artifact is gone before restore", !existsSync(installedDir));
const restore = oas(["install", "--dir", scopeA, "--no-requirements", "--json"], { allowFailure: true });
check("bare `oas install` restores from the lock", restore.status === 0, restore.stderr);
check("the artifact is re-materialized", existsSync(installedDir));
const restored = walk(installedDir);
check("restore reproduces the same file set",
  JSON.stringify(restored.files) === JSON.stringify(materialized.files),
  `restored=${restored.files.length} original=${materialized.files.length}`);
check("restore is EXACT — the lock is byte-identical", readFileSync(lockPath, "utf8") === lockBeforeRestore);
const lockAfterRestore = JSON.parse(readFileSync(lockPath, "utf8"));
check("restore advances neither source, version nor commit",
  lockAfterRestore.packages["oas.okf"].commit === sourceCommit
  && lockAfterRestore.packages["oas.okf"].source === packageRow.source
  && lockAfterRestore.capabilities["oas.okf"].version === "2.0.0");
check("restore preserves the artifact integrity and its approval",
  lockAfterRestore.capabilities["oas.okf"].integrity === capabilityRow.integrity
  && lockAfterRestore.capabilities["oas.okf"].trusted === true);

// ---------- scope B: explicit adoption, adopted base, composition ----------
section("Explicit template adoption and the recorded adopted base");
const scopeB = join(probeRoot, "adopter");
mkdirSync(scopeB, { recursive: true });
git(scopeB, "init", "-q", "-b", "main");
git(scopeB, "config", "user.email", "probe@example.invalid");
git(scopeB, "config", "user.name", "oas.okf consumer probe");
const adopt = oas(["init", "--package", sourceSpec, "--config", "default", "--dir", scopeB], { allowFailure: true });
check("`oas init --package ... --config default` succeeds", adopt.status === 0, adopt.stderr || adopt.stdout);
const adoptedConfig = join(scopeB, "oas-config.yaml");
check("adoption writes the scope's oas-config.yaml", existsSync(adoptedConfig));
check("the adopted config is the shipped template verbatim",
  existsSync(adoptedConfig) && readFileSync(adoptedConfig, "utf8") === template);
const baseDir = join(scopeB, ".agents", "config-templates", "adopted", "oas.okf", "default");
check("the adopted BASE is recorded", existsSync(join(baseDir, "oas-config.yaml")));
check("the adopted base is byte-identical to the template",
  existsSync(join(baseDir, "oas-config.yaml")) && readFileSync(join(baseDir, "oas-config.yaml"), "utf8") === template);
const adoption = existsSync(join(baseDir, "adoption.json")) ? JSON.parse(readFileSync(join(baseDir, "adoption.json"), "utf8")) : {};
check("adoption.json records the package, template, source, version, commit, path and hash",
  adoption.package === "oas.okf" && adoption.template === "default"
  && adoption.templatePath === "config-templates/default/oas-config.yaml"
  && adoption.source === `git:${sourceUrl}@probe-v2.0.0`
  && adoption.version === "2.0.0" && adoption.commit === sourceCommit
  && adoption.packagePath === "oas-package"
  && /^sha256-[0-9a-f]{64}$/.test(adoption.hash || ""),
  JSON.stringify(adoption));
check("the adopted base is NOT ignored (it is meant to be committed)",
  !gitIgnores(scopeB, relative(scopeB, join(baseDir, "oas-config.yaml"))));
const diff = oas(["config", "diff", "--dir", scopeB, "--json"], { allowFailure: true });
const diffReport = diff.status === 0 ? JSON.parse(diff.stdout) : {};
const diffRegions = diffReport?.result?.regions ?? diffReport?.regions ?? [];
check("`oas config diff` reports no drift immediately after adoption",
  diff.status === 0 && Array.isArray(diffRegions) && diffRegions.length === 0,
  diff.stdout.slice(0, 400) || diff.stderr.slice(0, 400));

section("Composition into an agent's instructions");
oas(["trust", "oas.okf", "--dir", scopeB], { allowFailure: true });
mkdirSync(join(scopeB, "agents"), { recursive: true });
const create = oas(["create", "okf-probe", "--description", "consumer probe soul"], { cwd: scopeB, allowFailure: true });
check("`oas create` scaffolds a soul at the adopting scope", create.status === 0, create.stderr || create.stdout);
const composed = oas(["doctor", scopeB, "--soul", "okf-probe"], { allowFailure: true });
const composedText = composed.stdout + composed.stderr;
check("the knowledge layer resolves to oas.okf for the soul", /oas\.okf/.test(composedText), composedText.slice(0, 300));
check("the capability's OKF injection composes into the soul's AGENTS.md",
  /Knowledge: OKF/.test(composedText) && /oas okf harvest/.test(composedText), composedText.slice(0, 400));
const scaffoldedSoul = join(scopeB, "agents", "okf-probe", "soul", "knowledge", "index.md");
check("the soul-scaffold hook produced an OKF bundle in the soul",
  existsSync(scaffoldedSoul) && /okf_version: "0\.1"/.test(readFileSync(scaffoldedSoul, "utf8")),
  scaffoldedSoul);

section("Released-kernel diagnostics recorded, not worked around");
// Maintainer ruling (final-v2 wave): the released 0.20.0 doctor emits an
// "in installed/ but has no lock entry" orphan warning for an ACTIVE
// package-materialized capability. It is a confirmed KERNEL defect — the
// legacy acquired-capability reader does not consult the v2 `capabilities`
// lock map. The package must not work around it, so the probe proves the
// warning's premise false and preserves the exact text as evidence.
const doctorAdopter = oas(["doctor", scopeB], { allowFailure: true });
const doctorText = doctorAdopter.stdout + doctorAdopter.stderr;
const orphanWarning = doctorText.split("\n").find((line) => /WARNING: oas\.okf .* has no lock entry/.test(line));
const adopterLock = JSON.parse(readFileSync(join(scopeB, "oas-lock.json"), "utf8"));
check("the scope's lock DOES carry the capability row the warning claims is missing",
  adopterLock.capabilities?.["oas.okf"]?.package === "oas.okf"
  && adopterLock.capabilities["oas.okf"].path === "capabilities/oas-okf"
  && /^sha256-/.test(adopterLock.capabilities["oas.okf"].integrity || ""),
  JSON.stringify(adopterLock.capabilities));
check("doctor resolves the layer and reports approved trust despite the warning",
  /knowledge\s+oas\.okf/.test(doctorText) && /trust: approved/.test(doctorText),
  doctorText.slice(0, 300));
if (orphanWarning) {
  process.stdout.write(`  note      known released-0.20.0 doctor defect, preserved verbatim:\n            ${orphanWarning.trim()}\n`);
} else {
  process.stdout.write("  note      the released 0.20.0 doctor orphan warning did not appear in this run\n");
}

// ---------- verdict ----------
section("Result");
process.stdout.write(`  kernel     ${kernelVersion}\n`);
process.stdout.write(`  source     ${sourceUrl}@probe-v2.0.0#oas-package\n`);
process.stdout.write(`  commit     ${sourceCommit}\n`);
process.stdout.write(`  package    ${packageRow.integrity}\n`);
process.stdout.write(`  capability ${capabilityRow.integrity}\n`);
process.stdout.write(`  kernel defects observed: ${orphanWarning ? "doctor orphan warning (upstream, not a package defect)" : "none"}\n`);
if (keep) process.stdout.write(`  workspace  ${probeRoot}\n`);
if (failures.length) {
  process.stderr.write(`\nConsumer probe FAILED ${failures.length}/${checks}:\n- ${failures.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write(`\nConsumer probe passed ${checks}/${checks} checks against the released ${REQUIRED_KERNEL} CLI.\n`);
