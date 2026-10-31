import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { asyncCache } from "../src/cache.ts";
import { stripAnsi } from "../src/colors.ts";
import { cloneConfig, DEFAULT_CONFIG, STATUS_KEY } from "../src/config.ts";
import { UPDATE_EVENT_WIDGET_EVENT } from "../src/event-widgets.ts";
import statuslineExtension from "../src/index.ts";
import type { StatuslineConfig, WidgetEntry } from "../src/types.ts";
import { registry } from "../src/widgets/registry.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

interface FooterComponent {
  render(width: number): string[];
  dispose?(): void;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
}

const GIT_OUTPUT: Record<string, string> = {
  "rev-parse --show-toplevel": "/work/repo",
  "rev-parse --short HEAD": "abc1234",
  "status --porcelain=v1": " M src/index.ts",
  "diff --shortstat HEAD": " 1 file changed, 2 insertions(+)",
  "rev-list --left-right --count @{upstream}...HEAD": "0\t1",
  "remote get-url origin": "git@example.com:org/repo.git",
};

// A minimal stand-in for pi's extension host: it records registrations, dispatches events to
// them, and mounts footer factories the way interactive mode does (dispose the previous
// footer, then build the new one with a TUI, theme, and footer data provider).
function createHost(cwd: string) {
  const handlers = new Map<string, Handler[]>();
  const busListeners = new Map<string, Set<(payload: unknown) => void>>();
  const branchListeners = new Set<() => void>();
  const statuses = new Map<string, string>();
  const tui = { requestRender: vi.fn<() => void>() };
  const theme = { fg: (_color: string, text: string) => text };
  let pendingExec: (() => void)[] | undefined;
  let footer: FooterComponent | undefined;
  let branch = "main";

  const exec = vi.fn<(command: string, args: string[]) => Promise<ExecResult>>(
    async (command, args) => {
      expect(command).toBe("git");
      const result = {
        stdout: GIT_OUTPUT[args.join(" ")] ?? "",
        stderr: "",
        code: 0,
        killed: false,
      };
      if (!pendingExec) return result;
      return new Promise((resolve) => pendingExec?.push(() => resolve(result)));
    },
  );

  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerCommand: vi.fn<(name: string, options: unknown) => void>(),
    events: {
      on(channel: string, listener: (payload: unknown) => void) {
        const listeners = busListeners.get(channel) ?? new Set();
        listeners.add(listener);
        busListeners.set(channel, listeners);
        return () => listeners.delete(listener);
      },
      emit(channel: string, payload: unknown) {
        for (const listener of busListeners.get(channel) ?? []) listener(payload);
      },
    },
    exec,
    getSessionName: () => undefined,
    getThinkingLevel: () => "off",
    getActiveTools: () => [],
  } as unknown as ExtensionAPI;

  const ctx = {
    hasUI: true,
    mode: "tui",
    cwd,
    model: undefined,
    modelRegistry: { isUsingOAuth: () => false },
    sessionManager: {
      getSessionId: () => "session-1",
      getBranch: () => [],
      getEntries: () => [],
    },
    getContextUsage: () => undefined,
    ui: {
      theme,
      notify: vi.fn<(message: string, type?: string) => void>(),
      setStatus(key: string, text: string | undefined) {
        if (text === undefined) statuses.delete(key);
        else statuses.set(key, text);
      },
      setFooter(factory: ((...args: unknown[]) => FooterComponent) | undefined) {
        footer?.dispose?.();
        footer = factory?.(tui, theme, {
          getGitBranch: () => branch,
          getExtensionStatuses: () => statuses,
          getAvailableProviderCount: () => 0,
          onBranchChange(listener: () => void) {
            branchListeners.add(listener);
            return () => branchListeners.delete(listener);
          },
        });
      },
    },
  } as unknown as ExtensionContext;

  return {
    pi,
    ctx,
    tui,
    exec,
    statuses,
    branchListeners,
    get footer() {
      return footer;
    },
    async emit(event: string, payload: object = {}) {
      for (const handler of handlers.get(event) ?? [])
        await handler({ type: event, ...payload }, ctx);
    },
    changeBranch(next: string) {
      branch = next;
      for (const listener of branchListeners) listener();
    },
    holdExec() {
      pendingExec = [];
    },
    releaseExec() {
      const waiting = pendingExec ?? [];
      pendingExec = undefined;
      for (const resolve of waiting) resolve();
    },
    gitRefreshes() {
      return exec.mock.calls.filter(([, args]) => args.join(" ") === "rev-parse --show-toplevel")
        .length;
    },
    render(width = 100) {
      if (!footer) throw new Error("no footer mounted");
      return footer.render(width).map(stripAnsi);
    },
  };
}

// Lets the async git fetch chain (pi.exec promises, then the cache update) settle.
async function settle() {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

function entry(type: Parameters<typeof registry.createEntry>[0], options = {}): WidgetEntry {
  return registry.createEntry(type, { raw: true, ...options });
}

let dir: string;
const originalConfigEnv = process.env.PI_FOOTER_CONFIG;

async function startFooter(lines: WidgetEntry[][], overrides: Partial<StatuslineConfig> = {}) {
  const config = { ...cloneConfig(DEFAULT_CONFIG), lines, ...overrides };
  await writeFile(process.env.PI_FOOTER_CONFIG ?? "", JSON.stringify(config), "utf8");
  const host = createHost(join(dir, "repo"));
  await statuslineExtension(host.pi);
  await host.emit("session_start", { reason: "startup" });
  return host;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pi-footer-hooks-"));
  process.env.PI_FOOTER_CONFIG = join(dir, "pi-footer.json");
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-01-01T00:00:00Z") });
});

afterEach(async () => {
  vi.useRealTimers();
  asyncCache.clear();
  if (originalConfigEnv === undefined) delete process.env.PI_FOOTER_CONFIG;
  else process.env.PI_FOOTER_CONFIG = originalConfigEnv;
  await rm(dir, { recursive: true, force: true });
});

const gitLine = () => [[entry("git-sha"), entry("flex-separator"), entry("git-branch")]];

describe("footer hooks through the registered extension", () => {
  it("mounts the footer on session start and renders fetched git data", async () => {
    const host = await startFooter(gitLine());

    expect(host.statuses.get(STATUS_KEY)).toBe("pi-footer");
    host.render();
    expect(host.gitRefreshes()).toBe(1);
    await settle();
    expect(host.tui.requestRender).toHaveBeenCalled();
    expect(host.render()[0]).toMatch(/^abc1234 +main$/);
  });

  it("serves git data from cache for the default 30 second interval", async () => {
    const host = await startFooter(gitLine());
    host.render();
    await settle();

    vi.advanceTimersByTime(29_000);
    host.render();
    await settle();
    expect(host.gitRefreshes()).toBe(1);

    vi.advanceTimersByTime(2000);
    host.render();
    await settle();
    expect(host.gitRefreshes()).toBe(2);
  });

  it("does not refresh git data on its own once the interval passes", async () => {
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
      now: Date.now(),
    });
    const host = await startFooter(gitLine());
    host.render();
    await settle();
    host.tui.requestRender.mockClear();
    const execCalls = host.exec.mock.calls.length;

    vi.advanceTimersByTime(60_000);
    await settle();
    expect(host.exec.mock.calls).toHaveLength(execCalls);
    expect(host.tui.requestRender).not.toHaveBeenCalled();

    host.render();
    expect(host.gitRefreshes()).toBe(2);
    await settle();
    expect(host.tui.requestRender).toHaveBeenCalledTimes(1);
    host.render();
    await settle();
    expect(host.gitRefreshes()).toBe(2);
  });

  it("uses a configured refresh interval", async () => {
    const host = await startFooter(gitLine(), { gitRefreshIntervalMs: 5000 });
    host.render();
    await settle();

    vi.advanceTimersByTime(4000);
    host.render();
    await settle();
    expect(host.gitRefreshes()).toBe(1);

    vi.advanceTimersByTime(2000);
    host.render();
    await settle();
    expect(host.gitRefreshes()).toBe(2);
  });

  it("refetches once after agent_end and repaints the mounted footer", async () => {
    const host = await startFooter(gitLine());
    host.render();
    await settle();
    host.tui.requestRender.mockClear();

    await host.emit("agent_end", { messages: [] });
    expect(host.tui.requestRender).toHaveBeenCalledTimes(1);

    host.render();
    await settle();
    host.render();
    await settle();
    expect(host.gitRefreshes()).toBe(2);
  });

  it("refetches after a branch change even within the interval", async () => {
    const host = await startFooter(gitLine());
    host.render();
    await settle();
    host.tui.requestRender.mockClear();

    host.changeBranch("main");
    expect(host.tui.requestRender).toHaveBeenCalledTimes(1);
    host.render();
    await settle();
    expect(host.gitRefreshes()).toBe(2);

    host.changeBranch("feature/x");
    host.render();
    await settle();
    expect(host.gitRefreshes()).toBe(3);
    expect(host.render()[0]).toMatch(/feature\/x$/);
  });

  it("does not trust a refresh that was in flight when agent_end invalidated it", async () => {
    const host = await startFooter(gitLine());
    host.holdExec();
    host.render();
    expect(host.gitRefreshes()).toBe(1);

    await host.emit("agent_end", { messages: [] });
    host.render();
    expect(host.gitRefreshes()).toBe(1);

    host.releaseExec();
    await settle();
    host.render();
    await settle();
    expect(host.gitRefreshes()).toBe(2);

    host.render();
    await settle();
    expect(host.gitRefreshes()).toBe(2);
  });

  it("runs no git commands when only status, event, and layout widgets are enabled", async () => {
    const host = await startFooter([
      [
        entry("external-status", { externalStatusKey: "cache-insights" }),
        entry("separator"),
        entry("event", { widgetId: "event_build" }),
        entry("flex-separator"),
        entry("custom-text", { text: "layout" }),
        entry("spacer"),
      ],
    ]);
    host.statuses.set("cache-insights", "cache 80%");
    host.pi.events.emit(UPDATE_EVENT_WIDGET_EVENT, { widgetId: "event_build", value: "build ok" });

    const [line] = host.render();
    await host.emit("agent_end", { messages: [] });
    host.changeBranch("other");
    host.render();
    await settle();

    expect(line).toContain("cache 80%");
    expect(line).toContain("build ok");
    expect(line).toMatch(/build ok +layout/);
    expect(host.exec).not.toHaveBeenCalled();
  });

  it("repaints for event widget updates only while the footer is mounted", async () => {
    const host = await startFooter([[entry("event", { widgetId: "event_build" })]]);
    host.tui.requestRender.mockClear();

    host.pi.events.emit(UPDATE_EVENT_WIDGET_EVENT, { widgetId: "event_build", value: "one" });
    expect(host.tui.requestRender).toHaveBeenCalledTimes(1);
    expect(host.render()[0]).toBe("one");

    await host.emit("session_shutdown", { reason: "quit" });
    host.tui.requestRender.mockClear();
    host.pi.events.emit(UPDATE_EVENT_WIDGET_EVENT, { widgetId: "event_build", value: "two" });
    expect(host.tui.requestRender).not.toHaveBeenCalled();
  });

  it("stops repainting and drops branch listeners after session_shutdown", async () => {
    const host = await startFooter(gitLine());
    host.render();
    await settle();
    expect(host.branchListeners.size).toBe(1);

    await host.emit("session_shutdown", { reason: "quit" });
    expect(host.footer).toBeUndefined();
    expect(host.statuses.has(STATUS_KEY)).toBe(false);
    expect(host.branchListeners.size).toBe(0);

    host.tui.requestRender.mockClear();
    await host.emit("agent_end", { messages: [] });
    await settle();
    expect(host.tui.requestRender).not.toHaveBeenCalled();
    expect(host.gitRefreshes()).toBe(1);
  });
});
