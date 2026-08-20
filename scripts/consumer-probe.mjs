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
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

// ---------- host isolation ----------
// The system under test is the RELEASED KERNEL, and it resolves executables and
// config from the environment. Inheriting the developer's PATH and HOME makes a
// green run depend on what that machine happens to have installed — the probe
// would "prove" behavior it never controlled. So every kernel invocation runs
// with a synthetic PATH, HOME and TMPDIR.
//
// The kernel's external-executable surface, audited across every exec-family
// call site in the packed 0.20.0 `lib/` + `bin/` (execFileSync, execFile,
// execSync, spawnSync, spawn):
//
//   PATH-resolved and NEEDED by the command set this probe exercises:
//     git    clone/checkout/worktree/rev-parse for git package sources
//     npm    `npm ci` for a capability runtime closure; `npm view` on update
//     node   CLI shebang, and capability command dispatch (spawnSync("node"))
//
//   PATH-resolved and NOT needed here, so poisoned rather than linked. Being
//   part of the kernel's surface is not a reason to make one reachable: the
//   test is whether THIS probe's operations require it. `cp` is the instructive
//   case — it is real kernel surface, but only for LOCAL standalone-capability
//   acquisition, and this probe acquires from a git source. Linking it would
//   silently permit an accidental new call.
//     cp      `cp -R` for a local standalone-capability copy (core.mjs:942)
//     pi      runtime launch, and `pi list --no-approve`
//     claude  runtime launch, and `claude plugin list`
//     tmux    session/window creation, and tmux-config reload
//     brew    an allowlisted host-requirement install manager
//
//   NOT PATH-resolved, so not expressible as a stub:
//     /bin/sh   execSync() in sh()/shIn() runs an absolute interpreter. The
//               COMMAND STRINGS it runs do resolve through PATH (`command -v
//               <bin>` in which(), `git -C ...` in shTry), so they are covered
//               by the synthetic PATH above.
//
//   DYNAMIC argv, unreachable for this package:
//     host-requirement recipes (packages.mjs:1182, `execFileSync(step[0], ...)`)
//     run an arbitrary allowlisted manager. oas.okf declares `requires: []`, so
//     no recipe exists to run — asserted below rather than assumed.
//
// Required tools are linked in from the real PATH. The launch-path names get a
// stub that FAILS LOUDLY and records itself, so "the probe passed" also means
// "the kernel reached no ambient binary" instead of merely "this laptop had pi
// installed and nothing noticed".
//
// One honest limit of the stubs: `which()` only RESOLVES a name, it does not
// execute it, so a stub makes a binary look present without leaving a witness
// entry. That is exactly why the absent direction below is also checked.
const probeBin = join(probeRoot, "bin");
const probeHome = join(probeRoot, "home");
const probeTmp = join(probeRoot, "tmp");
const witness = join(probeRoot, "ambient-executions.log");
for (const dir of [probeBin, probeHome, probeTmp]) mkdirSync(dir, { recursive: true });

const REQUIRED_TOOLS = ["node", "git", "npm"];
const FORBIDDEN_TOOLS = ["pi", "claude", "tmux", "brew", "cp", "acli", "codex"];
const hostPathDirs = (process.env.PATH || "").split(":").filter(Boolean);
const findOnHostPath = (bin) => hostPathDirs.map((d) => join(d, bin)).find((p) => existsSync(p));
for (const tool of REQUIRED_TOOLS) {
  const real = findOnHostPath(tool);
  if (!real) { process.stderr.write(`the probe needs ${tool} on PATH\n`); process.exit(1); }
  symlinkSync(real, join(probeBin, tool));
}
/** Write the fail-loud stubs. Kept callable so the absent-direction check can
 * remove and restore them. */
function plantForbiddenStubs() {
  for (const tool of FORBIDDEN_TOOLS) {
    const stub = join(probeBin, tool);
    if (existsSync(stub)) continue;
    writeFileSync(stub, `#!/bin/sh
printf '%s %s\n' "${tool}" "$*" >> ${JSON.stringify(witness)}
printf 'PROBE VIOLATION: the kernel invoked ambient "${tool}"\n' >&2
exit 97
`);
    chmodSync(stub, 0o755);
  }
}
const removeForbiddenStubs = () => { for (const tool of FORBIDDEN_TOOLS) rmSync(join(probeBin, tool), { force: true }); };
plantForbiddenStubs();

const isolatedEnv = {
  PATH: probeBin,
  HOME: probeHome,
  TMPDIR: probeTmp,
  // The developer's git identity and hooks must not reach the kernel's clones.
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  OAS_NO_LAUNCH: "1",
};

/** `isolated: false` is for PROBE SETUP only (fetching the kernel from npm),
 * which is not the system under test and legitimately needs the host registry
 * configuration. Every kernel invocation stays isolated. */
function sh(command, args, { cwd = probeRoot, env = {}, allowFailure = false, isolated = true } = {}) {
  // spawnSync, not execFileSync: execFileSync only surfaces stderr on THROW, so
  // a successful command's stderr was unavailable and any comparison of it was
  // vacuously equal. spawnSync captures all three streams on every outcome.
  const result = spawnSync(command, args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: isolated
      ? { ...isolatedEnv, ...env }
      : { ...process.env, OAS_NO_LAUNCH: "1", GIT_TERMINAL_PROMPT: "0", ...env },
  });
  const stdout = result.stdout ?? "";
  // A child with no exit status failed, and the helper's contract is that every
  // such failure carries its REASON on stderr. The two no-status shapes differ:
  // a spawn that never started sets `error` (ENOENT), while one killed by a
  // signal sets `signal` and usually no `error` at all — and may have written
  // nothing, which would otherwise surface as an opaque `{ status: 1,
  // stderr: "" }`. Both reasons are appended explicitly.
  const reasons = [];
  if (result.error) reasons.push(result.error.message);
  if (result.signal) reasons.push(`terminated by signal ${result.signal}`);
  const captured = result.stderr ?? "";
  const stderr = reasons.length
    ? `${captured}${captured && !captured.endsWith("\n") ? "\n" : ""}${reasons.join("; ")}`
    : captured;
  const status = result.status ?? (reasons.length ? 1 : 0);
  if (status !== 0 && !allowFailure) {
    process.stderr.write(`\nprobe command failed: ${command} ${args.join(" ")}\n${stdout}\n${stderr}\n`);
    process.exit(1);
  }
  return { status, stdout, stderr };
}
const git = (cwd, ...args) => sh("git", args, { cwd });
// `git check-ignore` exits 1 to mean "not ignored" — a normal answer, not a failure.
const gitIgnores = (cwd, path) => sh("git", ["check-ignore", "-q", path], { cwd, allowFailure: true }).status === 0;

// ---------- harness self-check ----------
// Every stderr comparison below is only as good as the harness's ability to
// capture stderr from a command that SUCCEEDS. execFileSync surfaces stderr
// only when it throws, which silently made such comparisons vacuous. Pin it.
section("Harness");
const stderrOnSuccess = sh(join(probeBin, "node"),
  ["-e", "console.error('harness-stderr-check'); console.log('ok'); process.exit(0)"], { allowFailure: true });
check("the harness captures stderr from a SUCCESSFUL command",
  stderrOnSuccess.status === 0
  && /harness-stderr-check/.test(stderrOnSuccess.stderr)
  && /ok/.test(stderrOnSuccess.stdout),
  `status=${stderrOnSuccess.status} stderr=${JSON.stringify(stderrOnSuccess.stderr)}`);
const spawnFailure = sh(join(probeBin, "definitely-absent-binary"), [], { allowFailure: true });
check("a spawn that never starts is reported as a failure carrying its reason",
  spawnFailure.status !== 0 && spawnFailure.stderr.length > 0,
  `status=${spawnFailure.status} stderr=${JSON.stringify(spawnFailure.stderr).slice(0, 120)}`);
// The other no-status shape: killed by a signal, with `signal` set, no `error`,
// and nothing written. Without an explicit reason this is an opaque failure.
const signalled = sh(join(probeBin, "node"),
  ["-e", "process.kill(process.pid, 'SIGKILL')"], { allowFailure: true });
check("a signal-terminated command is reported as a failure naming the signal",
  signalled.status !== 0 && /terminated by signal SIGKILL/.test(signalled.stderr),
  `status=${signalled.status} signal-reason=${JSON.stringify(signalled.stderr).slice(0, 120)}`);

// ---------- released kernel ----------
section("Released kernel");
let cli = process.env.OAS_PROBE_CLI;
if (!cli) {
  const prefix = join(probeRoot, "kernel");
  mkdirSync(prefix, { recursive: true });
  writeFileSync(join(prefix, "package.json"), JSON.stringify({ name: "oas-okf-probe-host", private: true, version: "0.0.0" }) + "\n");
  sh("npm", ["install", `@oas-framework/oas@${REQUIRED_KERNEL}`, "--no-audit", "--no-fund", "--loglevel", "error"], { cwd: prefix, isolated: false });
  cli = join(prefix, "node_modules", ".bin", "oas");
}
// EXACT version, from the structured envelope — a substring match on the human
// line would accept 10.20.0 or 0.20.0-dev, and OAS_PROBE_CLI can point anywhere.
const versionRun = sh(cli, ["version", "--json"], { allowFailure: true });
let kernelVersion = null;
try { kernelVersion = JSON.parse(versionRun.stdout).version; } catch { /* reported by the check */ }
check(`released CLI is exactly @oas-framework/oas@${REQUIRED_KERNEL}`,
  versionRun.status === 0 && kernelVersion === REQUIRED_KERNEL,
  `got ${JSON.stringify(kernelVersion ?? versionRun.stdout.trim())}`);
if (kernelVersion !== REQUIRED_KERNEL) { process.stderr.write(`refusing to probe against kernel ${kernelVersion ?? "(unreadable)"} — this probe asserts the ${REQUIRED_KERNEL} contract\n`); process.exit(1); }
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
// allowFailure so the assertion can actually FAIL: without it sh() exits the
// process on a nonzero status and `status === 0` could only ever be true.
const install = oas(["install", sourceSpec, "--dir", scopeA, "--no-requirements", "--json"], { allowFailure: true });
check("`oas install <git source>` succeeds", install.status === 0, install.stderr || install.stdout);
if (install.status !== 0) { process.stderr.write("\nacquisition failed — the remaining checks have nothing to inspect\n"); process.exit(1); }

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

/** Every file under `dir` with its CONTENT digest, plus any symlink it
 * contains. Names alone prove nothing: a materializer or restore that kept the
 * filenames and changed the bytes would satisfy a filename comparison while
 * shipping something other than the authored payload. */
function snapshot(dir) {
  const files = [];
  const digests = new Map();
  const symlinks = [];
  const recurse = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const rel = relative(dir, path);
      if (entry.isSymbolicLink()) { symlinks.push(rel); continue; }
      if (entry.isDirectory()) { recurse(path); continue; }
      files.push(rel);
      digests.set(rel, createHash("sha256").update(readFileSync(path)).digest("hex"));
    }
  };
  if (existsSync(dir)) recurse(dir);
  return { files: files.sort(), digests, symlinks: symlinks.sort() };
}
/** rels present in both, with identical bytes. */
const sameBytes = (a, b, rels) => rels.every((rel) => a.digests.get(rel) !== undefined && a.digests.get(rel) === b.digests.get(rel));

const materialized = snapshot(installedDir);
const authored = snapshot(capabilityRoot);
check("materialized artifact is FLAT — it contains no symlinks", materialized.symlinks.length === 0, materialized.symlinks.join(", "));
// The kernel writes exactly one file of its own into the artifact: the
// `.oas-installation.json` provenance record. Anything else appearing here
// would mean the materialized bytes are not the authored bytes.
const PROVENANCE = ".oas-installation.json";
check("materialized artifact is the authored capability plus only the kernel's provenance record",
  JSON.stringify(materialized.files) === JSON.stringify([...authored.files, PROVENANCE].sort()),
  `installed=${materialized.files.join(",")} authored=${authored.files.join(",")}`);
check("every authored file is byte-identical in the materialized artifact",
  authored.files.length > 0 && sameBytes(authored, materialized, authored.files),
  authored.files.filter((rel) => authored.digests.get(rel) !== materialized.digests.get(rel)).join(", ") || "no authored files found");
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
const restored = snapshot(installedDir);
check("restore reproduces the same file set",
  JSON.stringify(restored.files) === JSON.stringify(materialized.files),
  `restored=${restored.files.length} original=${materialized.files.length}`);
check("restore reproduces the artifact BYTE-for-byte, provenance record included",
  materialized.files.length > 0 && sameBytes(materialized, restored, materialized.files),
  materialized.files.filter((rel) => materialized.digests.get(rel) !== restored.digests.get(rel)).join(", ") || "nothing materialized to compare");
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

section("Host isolation — the kernel reached nothing ambient");
// Direction 1: the launch-path binaries EXIST on PATH throughout everything
// above, but are poisoned. A green run therefore means the kernel never invoked
// them — not that this machine lacked them.
const ambient = existsSync(witness) ? readFileSync(witness, "utf8").trim() : "";
check("no ambient runtime or multiplexer binary was invoked at any point", ambient === "", ambient);
check("the kernel ran against a synthetic PATH containing only our tools",
  readdirSync(probeBin).sort().join(",") === [...REQUIRED_TOOLS, ...FORBIDDEN_TOOLS].sort().join(","),
  readdirSync(probeBin).sort().join(","));
check("the kernel ran against a synthetic HOME, not the developer's",
  isolatedEnv.HOME === probeHome && isolatedEnv.HOME !== (process.env.HOME || ""), isolatedEnv.HOME);
// The kernel runs `which(<cmd>)` once per capability `requires[]` entry, and a
// stub would make any such command look PRESENT. Prove there are none, rather
// than assuming it: otherwise a host requirement could silently decide the
// result.
const installedManifestAtScope = JSON.parse(readFileSync(join(installedDir, "oas.json"), "utf8"));
check("the capability declares no host requirement, so no PATH lookup can influence the result",
  Array.isArray(installedManifestAtScope.requires) && installedManifestAtScope.requires.length === 0,
  JSON.stringify(installedManifestAtScope.requires));

// Direction 2 must be SYMMETRIC to direction 1, or it compares nothing. Both
// runs start from the same scope state (artifact deleted), perform the same
// operation (a real restore, not a no-op reconcile over an artifact that is
// already present), and are compared on the same observations.
function deleteAndRestore() {
  rmSync(installedDir, { recursive: true, force: true });
  const install = oas(["install", "--dir", scopeA, "--no-requirements", "--json"], { allowFailure: true });
  const doctor = oas(["doctor", scopeA, "--json"], { allowFailure: true });
  return {
    status: install.status,
    artifact: snapshot(installedDir),
    lock: readFileSync(lockPath, "utf8"),
    doctorStatus: doctor.status,
    // Absolute paths are identical between the two runs (same scope, same
    // probe root); only the poisoned/absent stubs differ, and they appear
    // nowhere in doctor's output. So this is compared verbatim.
    doctorJson: doctor.stdout,
    doctorStderr: doctor.stderr,
    doctorParsed: (() => { try { return JSON.parse(doctor.stdout); } catch { return undefined; } })(),
  };
}
/** A doctor observation only counts if it IS one: two identical failures with
 * empty stdout would otherwise compare equal and prove nothing. */
const doctorIsMeaningful = (run) =>
  run.doctorStatus === 0
  && typeof run.doctorJson === "string" && run.doctorJson.trim().length > 0
  && !!run.doctorParsed && typeof run.doctorParsed === "object";
rmSync(witness, { force: true });
const poisonedRun = deleteAndRestore();
const witnessAfterPoisoned = existsSync(witness) ? readFileSync(witness, "utf8").trim() : "";
removeForbiddenStubs();
const absentRun = deleteAndRestore();
plantForbiddenStubs();

check("the poisoned restore reached no ambient binary", witnessAfterPoisoned === "", witnessAfterPoisoned);
check("restore succeeds identically with the runtimes POISONED and ABSENT",
  poisonedRun.status === 0 && absentRun.status === 0,
  `poisoned=${poisonedRun.status} absent=${absentRun.status}`);
check("both restores produce the same artifact, byte for byte",
  JSON.stringify(poisonedRun.artifact.files) === JSON.stringify(absentRun.artifact.files)
  && poisonedRun.artifact.files.length > 0
  && sameBytes(poisonedRun.artifact, absentRun.artifact, poisonedRun.artifact.files),
  `poisoned=${poisonedRun.artifact.files.length} absent=${absentRun.artifact.files.length}`);
check("both restores leave a byte-identical lock", poisonedRun.lock === absentRun.lock);
check("the lock still matches the pre-isolation restore", absentRun.lock === lockBeforeRestore);
check("both doctor runs actually succeeded and returned a parseable envelope",
  doctorIsMeaningful(poisonedRun) && doctorIsMeaningful(absentRun),
  `poisoned status=${poisonedRun.doctorStatus} bytes=${poisonedRun.doctorJson.length} parsed=${!!poisonedRun.doctorParsed}; ` +
  `absent status=${absentRun.doctorStatus} bytes=${absentRun.doctorJson.length} parsed=${!!absentRun.doctorParsed}`);
check("the doctor envelope describes THIS scope's installed capability",
  JSON.stringify(poisonedRun.doctorParsed ?? {}).includes("oas.okf"),
  JSON.stringify(poisonedRun.doctorParsed ?? {}).slice(0, 200));
check("doctor reports identically with the runtimes POISONED and ABSENT",
  poisonedRun.doctorStatus === absentRun.doctorStatus
  && poisonedRun.doctorJson === absentRun.doctorJson
  && poisonedRun.doctorStderr === absentRun.doctorStderr,
  `status ${poisonedRun.doctorStatus}/${absentRun.doctorStatus}; stdout equal: ${poisonedRun.doctorJson === absentRun.doctorJson}; stderr equal: ${poisonedRun.doctorStderr === absentRun.doctorStderr}`);

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
process.stdout.write(`  kernel     @oas-framework/oas@${kernelVersion}\n`);
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
