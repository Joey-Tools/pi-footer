import type * as PiTui from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import { stripAnsi } from "../src/colors.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { renderStatuslines } from "../src/render.ts";
import type { StatuslineConfig } from "../src/types.ts";
import { registry } from "../src/widgets/registry.ts";
import { WidgetStore } from "../src/widgets/store.ts";
import { makeStatuslineData } from "./helpers/render.ts";

// pi-tui is supplied by the host at runtime. Simulate a host whose truncateToWidth keeps the
// ellipsis even when the requested width leaves no room for it.
vi.mock("@earendil-works/pi-tui", async (importOriginal) => {
  const original = await importOriginal<typeof PiTui>();
  return {
    ...original,
    truncateToWidth: (text: string, maxWidth: number, ellipsis?: string) =>
      maxWidth <= 0 ? (ellipsis ?? "") : original.truncateToWidth(text, maxWidth, ellipsis),
  };
});

const cfg = {
  ...DEFAULT_CONFIG,
  separator: "none",
  terminal: { ...DEFAULT_CONFIG.terminal, colorLevel: "none", widthMode: "full" },
  lines: [
    [
      registry.createEntry("custom-text", { raw: true, text: "left-side" }),
      registry.createEntry("flex-separator"),
      registry.createEntry("custom-text", { raw: true, text: "model" }),
    ],
  ],
} satisfies StatuslineConfig;

describe("flex layouts on hosts that always emit an ellipsis", () => {
  it("drops the left side instead of letting an ellipsis touch the right side", () => {
    const render = (width: number) =>
      renderStatuslines(WidgetStore.fromConfig(cfg), makeStatuslineData(), width).map(stripAnsi);
    expect(render(5)).toEqual(["model"]);
    expect(render(6)).toEqual([" model"]);
    expect(render(7)).toEqual(["… model"]);
  });
});
