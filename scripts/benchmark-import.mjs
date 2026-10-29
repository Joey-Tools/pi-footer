#!/usr/bin/env node
// Time how long a pi host takes to load a pi-footer package through the public
// discoverAndLoadExtensions() API, each sample in a fresh, isolated Node process.
//
//   node scripts/benchmark-import.mjs [package-dir] [--runs N] [--cold]
//
// extensionLoadMs covers module resolution, transform, evaluation, and the extension factory,
// measured after the host SDK import (reported separately as hostImportMs). It is not full CLI
// startup. --cold gives every sample an empty jiti transform cache; the default reuses one cache
// after a discarded warm-up sample. PI_FOOTER_HOST_DIR or PI_PACKAGE_DIR selects the host.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  createRunDir,
  hostPackageDir,
  importHost,
  isolateEnvironment,
  repoRoot,
} from "./lib/pi-host.mjs";

const args = process.argv.slice(2);

if (args[0] === "--child") {
  const [, packageDir, root] = args;
  const paths = isolateEnvironment(root);
  const importStart = performance.now();
  const { sdk, version } = await importHost(hostPackageDir());
  const hostImportMs = performance.now() - importStart;
  const loadStart = performance.now();
  const loaded = await sdk.discoverAndLoadExtensions([packageDir], paths.work, paths.agent);
  const extensionLoadMs = performance.now() - loadStart;
  console.log(
    JSON.stringify({
      version,
      extensions: loaded.extensions.length,
      footerLoaded: loaded.extensions.some((extension) => extension.commands.has("footer")),
      errors: loaded.errors,
      hostImportMs,
      extensionLoadMs,
    }),
  );
} else {
  const runsIndex = args.indexOf("--runs");
  const runs = runsIndex === -1 ? 10 : Number(args[runsIndex + 1]);
  const cold = args.includes("--cold");
  const packageArg = args.find(
    (arg, index) => !arg.startsWith("--") && (runsIndex === -1 || index !== runsIndex + 1),
  );
  const packageDir = resolve(packageArg ?? repoRoot);
  if (!existsSync(join(packageDir, "package.json"))) {
    throw new Error(`${packageDir} is not a package root`);
  }
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs needs a positive integer");

  const keepDir = process.env.PI_FOOTER_BENCH_DIR;
  const base = createRunDir(keepDir, "pi-footer-bench-");
  const sample = (index) => {
    const root = join(base, cold ? `run-${index}` : "shared");
    const output = execFileSync(
      process.execPath,
      [fileURLToPath(new URL(import.meta.url)), "--child", packageDir, root],
      { encoding: "utf8" },
    );
    const result = JSON.parse(output.trim().split("\n").at(-1) ?? "{}");
    if (result.errors?.length || result.extensions < 1 || !result.footerLoaded) {
      throw new Error(`footer load failed: ${JSON.stringify(result)}`);
    }
    return result;
  };

  try {
    if (!cold) sample("warmup");
    const samples = Array.from({ length: runs }, (_, index) => sample(index));
    const stats = (key) => {
      const values = samples.map((entry) => entry[key]).sort((a, b) => a - b);
      const round = (value) => Math.round(value * 10) / 10;
      const middle = Math.floor(values.length / 2);
      const median =
        values.length % 2 === 0
          ? ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2
          : (values[middle] ?? 0);
      return {
        median: round(median),
        min: round(values[0] ?? 0),
        max: round(values.at(-1) ?? 0),
      };
    };
    console.log(
      JSON.stringify(
        {
          package: packageDir,
          host: { version: samples[0]?.version, dir: hostPackageDir() },
          node: process.version,
          cache: cold ? "cold" : "warm",
          runs,
          extensionLoadMs: stats("extensionLoadMs"),
          hostImportMs: stats("hostImportMs"),
        },
        null,
        2,
      ),
    );
  } finally {
    if (!keepDir) rmSync(base, { recursive: true, force: true });
  }
}
