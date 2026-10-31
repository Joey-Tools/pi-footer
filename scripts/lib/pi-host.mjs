// Shared setup for the offline host scripts: choose the pi host package, isolate every
// location pi or jiti might read or write, then import the host's public SDK entry.
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// PI_FOOTER_HOST_DIR (or PI_PACKAGE_DIR, which pi itself also reads) selects the installed
// @earendil-works/pi-coding-agent package. The repository's peer install is the fallback.
export function hostPackageDir() {
  return resolve(
    process.env.PI_FOOTER_HOST_DIR ??
      process.env.PI_PACKAGE_DIR ??
      join(repoRoot, "node_modules/@earendil-works/pi-coding-agent"),
  );
}

// A retained artifact parent can be reused safely: each invocation still starts in a fresh
// directory, so cold benchmarks and extracted packages cannot inherit previous results.
export function createRunDir(keepDir, prefix) {
  const parent = keepDir ? resolve(keepDir) : tmpdir();
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, prefix));
}

// Must run before the host is imported: pi resolves its agent, session, and config
// locations from these variables, and jiti writes its transform cache under the temp
// directory or the working directory's node_modules/.cache.
export function isolateEnvironment(root) {
  const paths = {
    root,
    home: join(root, "home"),
    agent: join(root, "agent"),
    sessions: join(root, "sessions"),
    tmp: join(root, "tmp"),
    work: join(root, "work"),
    config: join(root, "pi-footer.json"),
    npmCache: join(root, "npm-cache"),
  };
  for (const dir of [paths.home, paths.agent, paths.sessions, paths.tmp, paths.work]) {
    mkdirSync(dir, { recursive: true });
  }

  Object.assign(process.env, {
    HOME: paths.home,
    USERPROFILE: paths.home,
    XDG_CONFIG_HOME: join(paths.home, ".config"),
    XDG_CACHE_HOME: join(paths.home, ".cache"),
    XDG_DATA_HOME: join(paths.home, ".local/share"),
    XDG_STATE_HOME: join(paths.home, ".local/state"),
    TMPDIR: paths.tmp,
    TMP: paths.tmp,
    TEMP: paths.tmp,
    PI_CODING_AGENT_DIR: paths.agent,
    PI_CODING_AGENT_SESSION_DIR: paths.sessions,
    PI_FOOTER_CONFIG: paths.config,
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
    PI_SKIP_VERSION_CHECK: "1",
    npm_config_cache: paths.npmCache,
    npm_config_update_notifier: "false",
  });
  process.chdir(paths.work);
  return paths;
}

export async function importHost(packageDir) {
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const exported = manifest.exports?.["."];
  const entry = (typeof exported === "string" ? exported : exported?.import) ?? manifest.main;
  if (!entry) throw new Error(`${packageDir} has no SDK entry point`);
  const sdk = await import(pathToFileURL(join(packageDir, entry)).href);
  return { sdk, version: manifest.version };
}
