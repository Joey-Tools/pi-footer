#!/usr/bin/env node
// Verifies the dependency tree that `pi install git:...` produced inside pi's
// own clone of this repository: every runtime dependency must be installed and
// no host-provided peer (the pi packages pi itself supplies at runtime) may be.
// Read-only: it inspects the clone and never modifies it.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Peers pi provides at runtime; they must never be installed into a package. */
export const HOST_PEERS = ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"];

/** Returns `$PI_CODING_AGENT_DIR/git/github.com/$GITHUB_REPOSITORY`, where pi clones git sources. */
export function resolveCloneDir(env) {
  const agentDir = env.PI_CODING_AGENT_DIR;
  const repository = env.GITHUB_REPOSITORY;
  if (!agentDir || !repository) {
    throw new Error("PI_CODING_AGENT_DIR and GITHUB_REPOSITORY must both be set");
  }
  return join(agentDir, "git", "github.com", ...repository.split("/"));
}

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function describeEntry(path) {
  const stat = lstatOrNull(path);
  if (!stat) return null;
  if (stat.isSymbolicLink() && !existsSync(path)) return "broken symlink";
  return stat.isSymbolicLink() ? "symlink" : "directory";
}

/** pnpm's virtual store names entries like `@scope+name@1.2.3...`. */
function virtualStorePrefix(name) {
  return `${name.replace("/", "+")}@`;
}

/** Returns a list of problems; an empty list means the clone is healthy. */
export function verifyRuntimeDeps(packageDir, hostPeers = HOST_PEERS) {
  const manifestPath = join(packageDir, "package.json");
  if (!existsSync(manifestPath)) return [`${manifestPath} does not exist`];

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const dependencies = Object.keys(manifest.dependencies ?? {});
  const declaredPeers = Object.keys(manifest.peerDependencies ?? {});
  const nodeModules = join(packageDir, "node_modules");
  const problems = [];

  for (const peer of hostPeers) {
    if (!declaredPeers.includes(peer)) {
      problems.push(`${peer} is not declared in peerDependencies`);
    }
  }

  for (const name of dependencies) {
    const entry = join(nodeModules, name);
    const kind = describeEntry(entry);
    if (!kind) {
      problems.push(`runtime dependency ${name} is not installed`);
    } else if (kind === "broken symlink") {
      problems.push(`runtime dependency ${name} is a broken symlink`);
    } else if (!existsSync(join(realpathSync(entry), "package.json"))) {
      problems.push(`runtime dependency ${name} has no package.json`);
    }
  }

  const virtualStore = join(nodeModules, ".pnpm");
  const virtualStoreEntries = existsSync(virtualStore) ? readdirSync(virtualStore) : [];
  for (const peer of new Set([...declaredPeers, ...hostPeers])) {
    const kind = describeEntry(join(nodeModules, peer));
    if (kind) problems.push(`host peer ${peer} is installed (${kind})`);
    const prefix = virtualStorePrefix(peer);
    for (const storeEntry of virtualStoreEntries.filter((entry) => entry.startsWith(prefix))) {
      problems.push(`host peer ${peer} is in the pnpm virtual store (${storeEntry})`);
    }
  }

  return problems;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const cloneDir = resolveCloneDir(process.env);
    const problems = verifyRuntimeDeps(cloneDir);
    if (problems.length > 0) {
      process.stderr.write(`Runtime dependency check failed for ${cloneDir}:\n`);
      for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`Runtime dependencies verified for ${cloneDir}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
