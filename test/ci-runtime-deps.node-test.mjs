// Behavior tests for .github/scripts/verify-git-runtime-deps.mjs.
// Run with `node --test test/ci-runtime-deps.node-test.mjs`; the name keeps it
// out of Vitest's default discovery.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  HOST_PEERS,
  resolveCloneDir,
  verifyRuntimeDeps,
} from "../.github/scripts/verify-git-runtime-deps.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(repoRoot, ".github/scripts/verify-git-runtime-deps.mjs");
const fixturesRoot = mkdtempSync(join(tmpdir(), "pi-footer-runtime-deps-"));
const repository = "Joey-Tools/pi-footer";
let fixtureCount = 0;

after(() => rmSync(fixturesRoot, { recursive: true, force: true }));

function writePackage(dir, name) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
}

/** Creates `<agentDir>/git/github.com/<repository>` holding this repo's real package.json. */
function createClone() {
  const agentDir = join(fixturesRoot, `agent-${fixtureCount++}`);
  const cloneDir = join(agentDir, "git", "github.com", ...repository.split("/"));
  mkdirSync(join(cloneDir, "node_modules"), { recursive: true });
  copyFileSync(join(repoRoot, "package.json"), join(cloneDir, "package.json"));
  return { agentDir, cloneDir };
}

/** Lays out a dependency the way pnpm does: a symlink into node_modules/.pnpm. */
function linkPnpmPackage(cloneDir, name, version) {
  const storeDir = join(cloneDir, "node_modules", ".pnpm", `${name.replace("/", "+")}@${version}`);
  const target = join(storeDir, "node_modules", name);
  writePackage(target, name);
  const link = join(cloneDir, "node_modules", name);
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link, "dir");
}

function runCli(env) {
  return spawnSync(process.execPath, [scriptPath], {
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
  });
}

describe("resolveCloneDir", () => {
  test("derives pi's git clone location from the environment", () => {
    assert.equal(
      resolveCloneDir({ PI_CODING_AGENT_DIR: "/agent", GITHUB_REPOSITORY: repository }),
      join("/agent", "git", "github.com", "Joey-Tools", "pi-footer"),
    );
  });

  test("requires both variables", () => {
    assert.throws(() => resolveCloneDir({ GITHUB_REPOSITORY: repository }), /must both be set/);
    assert.throws(() => resolveCloneDir({ PI_CODING_AGENT_DIR: "/agent" }), /must both be set/);
  });
});

describe("verifyRuntimeDeps", () => {
  test("accepts the repo manifest with an npm layout and no peers", () => {
    const { cloneDir } = createClone();
    writePackage(join(cloneDir, "node_modules", "chalk"), "chalk");
    assert.deepEqual(verifyRuntimeDeps(cloneDir), []);
  });

  test("checks pi's own packages as host peers", () => {
    assert.deepEqual(HOST_PEERS, ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]);
  });

  test("accepts a pnpm layout with runtime deps and no peers", () => {
    const { cloneDir } = createClone();
    linkPnpmPackage(cloneDir, "chalk", "6.0.1");
    assert.deepEqual(verifyRuntimeDeps(cloneDir), []);
  });

  test("rejects auto-installed host peers in node_modules and the virtual store", () => {
    const { cloneDir } = createClone();
    linkPnpmPackage(cloneDir, "chalk", "6.0.1");
    linkPnpmPackage(cloneDir, "@earendil-works/pi-coding-agent", "1.4.0");
    linkPnpmPackage(cloneDir, "@earendil-works/pi-tui", "1.4.0");
    assert.deepEqual(verifyRuntimeDeps(cloneDir), [
      "host peer @earendil-works/pi-coding-agent is installed (symlink)",
      "host peer @earendil-works/pi-coding-agent is in the pnpm virtual store (@earendil-works+pi-coding-agent@1.4.0)",
      "host peer @earendil-works/pi-tui is installed (symlink)",
      "host peer @earendil-works/pi-tui is in the pnpm virtual store (@earendil-works+pi-tui@1.4.0)",
    ]);
  });

  test("rejects a host peer left behind only in the virtual store", () => {
    const { cloneDir } = createClone();
    linkPnpmPackage(cloneDir, "chalk", "6.0.1");
    writePackage(
      join(cloneDir, "node_modules", ".pnpm", "@earendil-works+pi-tui@1.4.0", "node_modules", "x"),
      "x",
    );
    assert.deepEqual(verifyRuntimeDeps(cloneDir), [
      "host peer @earendil-works/pi-tui is in the pnpm virtual store (@earendil-works+pi-tui@1.4.0)",
    ]);
  });

  test("rejects a broken host peer symlink", () => {
    const { cloneDir } = createClone();
    writePackage(join(cloneDir, "node_modules", "chalk"), "chalk");
    mkdirSync(join(cloneDir, "node_modules", "@earendil-works"), { recursive: true });
    symlinkSync(
      join(cloneDir, "missing"),
      join(cloneDir, "node_modules", "@earendil-works", "pi-tui"),
      "dir",
    );
    assert.deepEqual(verifyRuntimeDeps(cloneDir), [
      "host peer @earendil-works/pi-tui is installed (broken symlink)",
    ]);
  });

  test("rejects a missing runtime dependency", () => {
    const { cloneDir } = createClone();
    assert.deepEqual(verifyRuntimeDeps(cloneDir), ["runtime dependency chalk is not installed"]);
  });

  test("rejects a broken runtime dependency symlink", () => {
    const { cloneDir } = createClone();
    symlinkSync(join(cloneDir, "missing"), join(cloneDir, "node_modules", "chalk"), "dir");
    assert.deepEqual(verifyRuntimeDeps(cloneDir), ["runtime dependency chalk is a broken symlink"]);
  });

  test("rejects a runtime dependency without a package.json", () => {
    const { cloneDir } = createClone();
    mkdirSync(join(cloneDir, "node_modules", "chalk"));
    assert.deepEqual(verifyRuntimeDeps(cloneDir), ["runtime dependency chalk has no package.json"]);
  });

  test("rejects a manifest that stops declaring a host peer", () => {
    const { cloneDir } = createClone();
    writePackage(join(cloneDir, "node_modules", "chalk"), "chalk");
    writeFileSync(
      join(cloneDir, "package.json"),
      JSON.stringify({
        dependencies: { chalk: "^6.0.0" },
        peerDependencies: { "@earendil-works/pi-coding-agent": "*" },
      }),
    );
    assert.deepEqual(verifyRuntimeDeps(cloneDir), [
      "@earendil-works/pi-tui is not declared in peerDependencies",
    ]);
  });

  test("rejects a missing clone", () => {
    const missing = join(fixturesRoot, "no-such-clone");
    assert.deepEqual(verifyRuntimeDeps(missing), [
      `${join(missing, "package.json")} does not exist`,
    ]);
  });
});

describe("CLI", () => {
  test("passes for a healthy clone found through the environment", () => {
    const { agentDir, cloneDir } = createClone();
    linkPnpmPackage(cloneDir, "chalk", "6.0.1");
    const result = runCli({ PI_CODING_AGENT_DIR: agentDir, GITHUB_REPOSITORY: repository });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Runtime dependencies verified/);
  });

  test("fails and lists problems when host peers were installed", () => {
    const { agentDir, cloneDir } = createClone();
    linkPnpmPackage(cloneDir, "chalk", "6.0.1");
    linkPnpmPackage(cloneDir, "@earendil-works/pi-coding-agent", "1.4.0");
    const result = runCli({ PI_CODING_AGENT_DIR: agentDir, GITHUB_REPOSITORY: repository });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /host peer @earendil-works\/pi-coding-agent is installed/);
  });

  test("fails when the environment does not locate a clone", () => {
    const result = runCli({ GITHUB_REPOSITORY: repository });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must both be set/);
  });
});
