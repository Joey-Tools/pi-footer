import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { stripAnsi } from "../src/colors.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { renderStatuslines } from "../src/render.ts";
import type { StatuslineConfig, WidgetEntry } from "../src/types.ts";
import { registry } from "../src/widgets/registry.ts";
import { WidgetStore } from "../src/widgets/store.ts";
import { foregroundsOf, hasOnlyCompleteEscapes, styledGraphemes } from "./helpers/ansi.ts";
import { makeStatuslineData } from "./helpers/render.ts";

const WARNING_FG = "38;2;255;170;0";
const DIM_FG = "38;2;128;128;128";
const LEFT_FG = "38;5;72";
const CACHE_WARNING = `\x1b[${WARNING_FG}m⚠ cache 12% · expired 4m\x1b[39m`;
const OTHER_STATUS = `\x1b[${DIM_FG}mlint ok\x1b[39m`;

function config(lines: WidgetEntry[][], overrides: Partial<StatuslineConfig> = {}) {
  return {
    ...DEFAULT_CONFIG,
    separator: "none",
    terminal: { ...DEFAULT_CONFIG.terminal, colorLevel: "ansi256", widthMode: "full" },
    lines,
    ...overrides,
  } satisfies StatuslineConfig;
}

function text(value: string, options: Record<string, unknown> = {}): WidgetEntry {
  return registry.createEntry("custom-text", { raw: true, text: value, ...options });
}

function status(key: string): WidgetEntry {
  return registry.createEntry("external-status", { externalStatusKey: key });
}

function flexLine(left: WidgetEntry[], right: WidgetEntry[]): WidgetEntry[] {
  return [...left, registry.createEntry("flex-separator"), ...right];
}

function render(cfg: StatuslineConfig, width: number, statuses = new Map<string, string>()) {
  return renderStatuslines(WidgetStore.fromConfig(cfg), makeStatuslineData(), width, {
    getExtensionStatuses: () => statuses,
  });
}

describe("flex layouts with a right-priority group", () => {
  const basic = config([flexLine([text("left-side")], [text("model")])]);

  it("renders nothing for zero or negative widths", () => {
    expect(render(basic, 0)).toEqual([]);
    expect(render(basic, -3)).toEqual([]);
  });

  it("gives a right side that exactly fills the width every column", () => {
    const [line] = render(basic, 5);
    expect(line).toBeDefined();
    expect(stripAnsi(line ?? "")).toBe("model");
  });

  it("drops the left side when only the one-space gap remains", () => {
    const [line] = render(basic, 6);
    expect(stripAnsi(line ?? "")).toBe(" model");
  });

  it("keeps the one-space gap when the left side is cut to an ellipsis", () => {
    const [line] = render(basic, 7);
    expect(stripAnsi(line ?? "")).toBe("… model");
  });

  it("clips an oversized right side inside the width without breaking its color", () => {
    const cfg = config([flexLine([text("left")], [status("cache-insights")])]);
    for (const width of [1, 2, 5, 10]) {
      const [line = ""] = render(cfg, width, new Map([["cache-insights", CACHE_WARNING]]));
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      expect(stripAnsi(line).endsWith("…")).toBe(true);
      expect(hasOnlyCompleteEscapes(line)).toBe(true);
      const unstyled = styledGraphemes(line).filter(
        (grapheme) => grapheme.text !== "…" && grapheme.fg !== WARNING_FG,
      );
      expect(unstyled).toEqual([]);
    }
  });

  it("keeps a colored external status on the right fully intact when it fits", () => {
    const statuses = new Map([
      ["cache-insights", CACHE_WARNING],
      ["other-ext", OTHER_STATUS],
    ]);
    const cfg = config([
      flexLine(
        [text("a-very-long-working-directory-name-that-cannot-fit", { fg: "ansi256:72" })],
        [status("other-ext"), text(" "), status("cache-insights")],
      ),
    ]);
    const statusWidth = visibleWidth(CACHE_WARNING) + 1 + visibleWidth(OTHER_STATUS);

    for (const width of [statusWidth + 1, statusWidth + 2, statusWidth + 12, 80]) {
      const [line = ""] = render(cfg, width, statuses);
      expect(visibleWidth(line)).toBe(width);
      expect(line.endsWith(CACHE_WARNING)).toBe(true);
      expect(line).toContain(OTHER_STATUS);
      expect(hasOnlyCompleteEscapes(line)).toBe(true);
      expect(foregroundsOf(line, "⚠ cache 12% · expired 4m")).toEqual(new Set([WARNING_FG]));
      expect(foregroundsOf(line, "lint ok")).toEqual(new Set([DIM_FG]));
    }
  });

  it("fits long styled left text with wide and combining characters into narrow widths", () => {
    const left = "日本語のプロジェクト-cafe\u0301-re\u0301sume\u0301-feature";
    const cfg = config([flexLine([text(left, { fg: "ansi256:72" })], [text("model")])]);
    let leftLetters = 0;

    for (const width of [7, 8, 9, 10, 11, 14, 20, 30]) {
      const [line = ""] = render(cfg, width);
      const plain = stripAnsi(line);
      expect(visibleWidth(line)).toBe(width);
      expect(plain.endsWith(" model")).toBe(true);
      expect(hasOnlyCompleteEscapes(line)).toBe(true);
      // A combining accent must never be split from its base letter.
      expect(plain.normalize("NFC")).not.toMatch(/\u0301/);
      expect(foregroundsOf(line, "model")).toEqual(new Set([undefined]));

      const graphemes = styledGraphemes(line);
      const leftText = graphemes
        .slice(0, graphemes.length - " model".length)
        .filter((grapheme) => grapheme.text !== " " && grapheme.text !== "…");
      expect(leftText.filter((grapheme) => grapheme.fg !== LEFT_FG)).toEqual([]);
      if (width >= 20) leftLetters += leftText.length;
    }
    expect(leftLetters).toBeGreaterThan(0);
  });

  it("follows a status that changes from an expired warning to a normal style", () => {
    const store = WidgetStore.fromConfig(
      config([flexLine([text("workspace")], [status("cache-insights")])]),
    );
    const statuses = new Map([["cache-insights", CACHE_WARNING]]);
    const options = { getExtensionStatuses: () => statuses };
    const normal = `\x1b[${DIM_FG}mcache warm 92%\x1b[39m`;

    const [expired = ""] = renderStatuslines(store, makeStatuslineData(), 40, options);
    statuses.set("cache-insights", normal);
    const [warm = ""] = renderStatuslines(store, makeStatuslineData(), 40, options);

    expect(expired.endsWith(CACHE_WARNING)).toBe(true);
    expect(warm.endsWith(normal)).toBe(true);
    expect(visibleWidth(warm)).toBe(40);
    expect(foregroundsOf(warm, "cache warm 92%")).toEqual(new Set([DIM_FG]));
    expect(styledGraphemes(warm).some((grapheme) => grapheme.fg === WARNING_FG)).toBe(false);
  });

  it("leaves lines without a flex separator and other lines unchanged", () => {
    const cfg = config([
      flexLine([text("left-side-that-will-be-cut")], [status("cache-insights")]),
      [status("other-ext"), text(" | "), text("plain line")],
    ]);
    const statuses = new Map([
      ["cache-insights", CACHE_WARNING],
      ["other-ext", OTHER_STATUS],
    ]);
    const lines = render(cfg, 40, statuses);

    expect(lines).toHaveLength(2);
    expect(lines[0]?.endsWith(CACHE_WARNING)).toBe(true);
    expect(lines[1]).toContain(OTHER_STATUS);
    expect(stripAnsi(lines[1] ?? "")).toBe("lint ok | plain line");
  });
});
