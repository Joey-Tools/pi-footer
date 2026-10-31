#!/usr/bin/env node
// Offline smoke test of pi-footer inside a real pi host, through the host's public SDK.
//
//   node scripts/smoke-extension.mjs           load the repository checkout
//   node scripts/smoke-extension.mjs --pack    load an `npm pack` tarball with only runtime deps
//
// PI_FOOTER_HOST_DIR or PI_PACKAGE_DIR selects the host package; PI_FOOTER_SMOKE_DIR keeps the
// isolated home/agent/session/temp tree there instead of a removed temporary directory. No
// model, provider, or telemetry requests are made; npm install in --pack mode uses the registry.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import {
  createRunDir,
  hostPackageDir,
  importHost,
  isolateEnvironment,
  repoRoot,
} from "./lib/pi-host.mjs";

const HOST_PROVIDED = new Set([
  "@earendil-works/pi-ai",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "typebox",
]);
const STATUS_KEY = "pi-footer";
const UPDATE_EVENT = "pi-footer:update-widget";
const SGR = { accent: 39, dim: 245, warning: 214, error: 196 };

const packMode = process.argv.includes("--pack");
const keepDir = process.env.PI_FOOTER_SMOKE_DIR;
const hostDir = hostPackageDir();
const root = createRunDir(keepDir, "pi-footer-smoke-");
const paths = isolateEnvironment(root);
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, env: process.env, encoding: "utf8" });
}

// Visible columns for the ASCII-plus-ellipsis text this smoke renders.
function plain(text) {
  // oxlint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
}

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

// Every manifest entry exists, relative imports name real files, and bare imports are node
// builtins, host-provided peers, or runtime dependencies installed next to the package.
function verifyPackageContents(packageDir) {
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const entries = manifest.pi?.extensions ?? [];
  check(entries.length > 0, "package.json declares no pi.extensions entry");
  for (const entry of entries) {
    check(existsSync(resolve(packageDir, entry)), `manifest entry is missing: ${entry}`);
  }

  const runtimeDeps = new Set(Object.keys(manifest.dependencies ?? {}));
  for (const name of Object.keys(manifest.peerDependencies ?? {})) {
    check(HOST_PROVIDED.has(name), `peer dependency is not host-provided: ${name}`);
    check(!runtimeDeps.has(name), `host package is also a runtime dependency: ${name}`);
  }

  const builtins = new Set(builtinModules);
  const pattern = /(?:\bfrom\s*|\bimport\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;
  for (const file of sourceFiles(join(packageDir, "src"))) {
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(pattern)) {
      const where = `${relative(packageDir, file)} imports ${specifier}`;
      if (specifier.startsWith(".")) {
        check(existsSync(resolve(dirname(file), specifier)), `${where}, which is not packaged`);
      } else if (specifier.startsWith("node:") || builtins.has(specifier)) {
        continue;
      } else if (HOST_PROVIDED.has(packageName(specifier))) {
        check(
          manifest.peerDependencies?.[packageName(specifier)] === "*",
          `${where} without a "*" peer dependency`,
        );
      } else {
        const name = packageName(specifier);
        check(runtimeDeps.has(name), `${where}, which is not a runtime dependency`);
        check(
          existsSync(join(packageDir, "node_modules", name)),
          `${where}, which is not installed`,
        );
      }
    }
  }
  return entries
    .map((entry) => resolve(packageDir, entry))
    .filter((entry) => existsSync(entry))
    .map((entry) => realpathSync(entry));
}

function packProductionPackage() {
  const packDir = join(paths.root, "pack");
  const extractDir = join(packDir, "extract");
  mkdirSync(extractDir, { recursive: true });
  const [packed] = JSON.parse(
    run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", packDir], repoRoot),
  );
  const files = packed.files.map((file) => file.path);
  check(
    files.every((file) => !file.startsWith("node_modules/") && !file.startsWith("test/")),
    "tarball contains node_modules or tests",
  );
  check(files.includes("package.json"), "tarball is missing package.json");
  run("tar", ["-xzf", join(packDir, packed.filename), "-C", extractDir]);
  const packageDir = join(extractDir, "package");
  run(
    "npm",
    ["install", "--omit=dev", "--legacy-peer-deps", "--ignore-scripts", "--no-audit", "--no-fund"],
    packageDir,
  );
  for (const name of HOST_PROVIDED) {
    check(!existsSync(join(packageDir, "node_modules", name)), `production install added ${name}`);
  }
  return { packageDir, tarball: packed.filename, files: files.length };
}

function ansiTheme() {
  const fg = (color, text) => `\x1b[38;5;${SGR[color] ?? 250}m${text}\x1b[39m`;
  return { fg, bg: (_color, text) => text, bold: (text) => `\x1b[1m${text}\x1b[22m` };
}

// A host UI that records statuses and mounts footers the way interactive mode does: the
// previous footer is disposed before the next factory runs.
function createUi(theme) {
  const statuses = new Map();
  const branchListeners = new Set();
  const tui = { renders: 0, requestRender: () => (tui.renders += 1) };
  const state = { footer: undefined };
  const noop = () => {};
  const ui = {
    theme,
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
    editor: async () => undefined,
    custom: async () => undefined,
    notify: noop,
    onTerminalInput: () => noop,
    setStatus(key, text) {
      if (text === undefined) statuses.delete(key);
      else statuses.set(key, text);
    },
    setFooter(factory) {
      state.footer?.dispose?.();
      state.footer = factory?.(tui, theme, {
        getGitBranch: () => null,
        getExtensionStatuses: () => statuses,
        getAvailableProviderCount: () => 0,
        onBranchChange(listener) {
          branchListeners.add(listener);
          return () => branchListeners.delete(listener);
        },
      });
    },
    setWorkingMessage: noop,
    setWorkingVisible: noop,
    setWorkingIndicator: noop,
    setHiddenThinkingLabel: noop,
    setWidget: noop,
    setHeader: noop,
    setTitle: noop,
    pasteToEditor: noop,
    setEditorText: noop,
    getEditorText: () => "",
    addAutocompleteProvider: noop,
    setEditorComponent: noop,
    getEditorComponent: () => undefined,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "smoke host has one theme" }),
    getToolsExpanded: () => false,
    setToolsExpanded: noop,
  };
  return { ui, tui, statuses, branchListeners, state };
}

function bindRunner(runner) {
  const noop = () => {};
  runner.bindCore(
    {
      sendMessage: noop,
      sendUserMessage: noop,
      appendEntry: noop,
      setSessionName: noop,
      getSessionName: () => undefined,
      setLabel: noop,
      getActiveTools: () => [],
      getAllTools: () => [],
      getSettings: () => ({}),
      setActiveTools: noop,
      refreshTools: noop,
      getCommands: () => [],
      setModel: async () => false,
      getThinkingLevel: () => "off",
      setThinkingLevel: noop,
    },
    {
      getModel: () => undefined,
      getScopedModels: () => [],
      isIdle: () => true,
      isProjectTrusted: () => false,
      getSignal: () => undefined,
      abort: noop,
      hasPendingMessages: () => false,
      shutdown: noop,
      getContextUsage: () => undefined,
      compact: noop,
      getSystemPrompt: () => "",
    },
  );
}

const STATUS_PUBLISHER = `
export default function (pi) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setStatus("cache-insights", ctx.ui.theme.fg("warning", "cache expired 4m"));
    ctx.ui.setStatus("lint", ctx.ui.theme.fg("dim", "lint ok"));
    pi.events.emit(${JSON.stringify(UPDATE_EVENT)}, { widgetId: "event_smoke", value: "build ok" });
  });
  pi.on("agent_end", (_event, ctx) => {
    ctx.ui.setStatus("cache-insights", ctx.ui.theme.fg("dim", "cache warm 92%"));
  });
}
`;

const FOOTER_CONFIG = {
  separator: "none",
  terminal: { colorLevel: "ansi256", widthMode: "full" },
  lines: [
    [
      { type: "custom-text", options: { raw: true, text: "workspace " } },
      { type: "event", options: { raw: true, widgetId: "event_smoke" } },
      { type: "flex-separator" },
      { type: "external-status", options: { externalStatusKey: "cache-insights" } },
    ],
  ],
};

async function main() {
  const packed = packMode ? packProductionPackage() : undefined;
  const packageDir = packed?.packageDir ?? repoRoot;
  const entries = verifyPackageContents(packageDir);

  const publisherPath = join(paths.work, "status-publisher.js");
  writeFileSync(publisherPath, STATUS_PUBLISHER, "utf8");
  writeFileSync(paths.config, JSON.stringify(FOOTER_CONFIG), "utf8");

  const importStart = performance.now();
  const { sdk, version } = await importHost(hostDir);
  const hostImportMs = performance.now() - importStart;

  const loadStart = performance.now();
  const loaded = await sdk.discoverAndLoadExtensions(
    [packageDir, publisherPath],
    paths.work,
    paths.agent,
  );
  const extensionLoadMs = performance.now() - loadStart;
  check(loaded.errors.length === 0, `extension errors: ${JSON.stringify(loaded.errors)}`);
  const footerExtension = loaded.extensions.find((ext) =>
    entries.includes(realpathSync(ext.resolvedPath)),
  );
  check(footerExtension !== undefined, "the manifest entry was not loaded");
  check(footerExtension?.commands.has("footer"), "the /footer command is not registered");
  for (const event of ["session_start", "agent_end", "session_shutdown", "model_select"]) {
    check(footerExtension?.handlers.has(event), `no ${event} handler is registered`);
  }

  const theme = ansiTheme();
  const host = createUi(theme);
  const sessionManager = sdk.SessionManager.inMemory(paths.work);
  const modelRegistry = { isUsingOAuth: () => false };
  const runner = new sdk.ExtensionRunner(
    loaded.extensions,
    loaded.runtime,
    paths.work,
    sessionManager,
    modelRegistry,
  );
  bindRunner(runner);
  runner.setUIContext(host.ui, "tui");
  runner.onError((error) => failures.push(`extension error: ${JSON.stringify(error)}`));

  await runner.emit({ type: "session_start", reason: "startup" });
  const footer = host.state.footer;
  check(footer !== undefined, "session_start did not mount the footer");
  check(host.statuses.get(STATUS_KEY) === theme.fg("accent", "pi-footer"), "own status missing");
  check(host.tui.renders > 0, "the event widget update did not request a render");

  const warning = theme.fg("warning", "cache expired 4m");
  const lint = theme.fg("dim", "lint ok");
  const rendered = {};
  for (const width of [100, 40, 24, 18, 17, 16, 12, 1]) {
    const lines = footer?.render(width) ?? [];
    rendered[width] = lines.map(plain);
    check(lines.length === 2, `width ${width}: expected footer and status rows`);
    for (const line of lines) {
      check(plain(line).length <= width, `width ${width}: line overflows: ${plain(line)}`);
    }
    const [layout = "", statusRow = ""] = lines;
    if (width >= 16) {
      check(plain(layout).length === width, `width ${width}: layout does not fill the width`);
      check(layout.endsWith(warning), `width ${width}: warning status lost its styling`);
    } else {
      check(plain(layout).endsWith("…"), `width ${width}: clipped status has no ellipsis`);
    }
    if (width === 100) {
      check(plain(layout).startsWith("workspace build ok "), "event widget value missing");
      check(statusRow.includes(lint) && statusRow.includes(warning), "status row lost a status");
    }
  }
  check(rendered[17]?.[0] === " cache expired 4m", "no-room left side was not dropped");
  check(rendered[18]?.[0] === "… cache expired 4m", "one-column left side lost its gap");

  const rendersBeforeAgentEnd = host.tui.renders;
  await runner.emit({ type: "agent_end", messages: [] });
  check(host.tui.renders === rendersBeforeAgentEnd + 1, "agent_end did not repaint the footer");
  const normal = theme.fg("dim", "cache warm 92%");
  const [afterTransition = ""] = footer?.render(40) ?? [];
  rendered.transition = plain(afterTransition);
  check(afterTransition.endsWith(normal), "the normal status did not replace the warning");
  check(!afterTransition.includes(warning), "the expired warning style is still rendered");

  await runner.emit({ type: "session_shutdown", reason: "quit" });
  check(host.state.footer === undefined, "session_shutdown left the footer mounted");
  check(!host.statuses.has(STATUS_KEY), "session_shutdown left the pi-footer status");
  check(host.branchListeners.size === 0, "the footer kept a branch listener after disposal");
  const rendersAfterShutdown = host.tui.renders;
  await runner.emit({ type: "agent_end", messages: [] });
  check(host.tui.renders === rendersAfterShutdown, "agent_end repainted a removed footer");

  const summary = {
    ok: failures.length === 0,
    mode: packMode ? "packed" : "source",
    host: { version, dir: hostDir },
    package: packed ? { tarball: packed.tarball, files: packed.files } : { dir: packageDir },
    hostImportMs: Math.round(hostImportMs),
    extensionLoadMs: Math.round(extensionLoadMs),
    rendered: {
      100: rendered[100],
      17: rendered[17],
      12: rendered[12],
      transition: rendered.transition,
    },
    failures,
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary.ok;
}

let ok = false;
try {
  ok = await main();
} catch (error) {
  console.error(error);
} finally {
  if (!keepDir) rmSync(root, { recursive: true, force: true });
}
process.exitCode = ok ? 0 : 1;
