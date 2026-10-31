import { describe, expect, it } from "vitest";

import { normalizeConfig } from "../src/config.ts";
import {
  SEPARATOR_VALUES,
  separatorText,
  WIDGET_SEPARATOR_VALUES,
  widgetSeparatorText,
} from "../src/separators.ts";

describe("separators", () => {
  it("formats global separator styles", () => {
    expect(separatorText("none")).toBe("");
    expect(separatorText("space")).toBe(" ");
    expect(separatorText("pipe")).toBe(" | ");
    expect(separatorText("powerline")).toBe(" \ue0b1 ");
    expect(separatorText("dash")).toBe(" - ");
    expect(separatorText("comma")).toBe(", ");
    expect(separatorText("dot")).toBe(" \u2022 ");
  });

  it("formats the Nerd Font chevron and circle separators", () => {
    expect(separatorText("chevron")).toBe(" \uf460 ");
    expect(separatorText("chevron-circle")).toBe(" \uf138 ");
    expect(separatorText("arrow-circle")).toBe(" \uf0a9 ");
  });

  it("accepts the chevron and circle separators as global and widget styles", () => {
    for (const separator of ["chevron", "chevron-circle", "arrow-circle"] as const) {
      expect(SEPARATOR_VALUES).toContain(separator);
      expect(WIDGET_SEPARATOR_VALUES).toContain(separator);
      expect(normalizeConfig({ separator }).separator).toBe(separator);
      expect(widgetSeparatorText(separator, "")).toBe(separatorText(separator));
    }
  });

  it("falls back to the preset separator for unknown values", () => {
    const fallback = normalizeConfig({}).separator;
    expect(normalizeConfig({ separator: "chevrons" }).separator).toBe(fallback);
    expect(normalizeConfig({ separator: 42 }).separator).toBe(fallback);
  });

  it("formats widget-only separator styles", () => {
    expect(widgetSeparatorText("custom", "/")).toBe("/");
    expect(widgetSeparatorText("powerline", "")).toBe("\ue0b0 ");
    expect(widgetSeparatorText("powerline-right-spaced", "")).toBe("\ue0b0 ");
    expect(widgetSeparatorText("powerline-right", "")).toBe("\ue0b0");
    expect(widgetSeparatorText("powerline-left-spaced", "")).toBe(" \ue0b2");
    expect(widgetSeparatorText("powerline-left", "")).toBe("\ue0b2");
    expect(widgetSeparatorText("powerline-soft-right", "")).toBe("\ue0b1");
    expect(widgetSeparatorText("powerline-soft-left", "")).toBe("\ue0b3");
    expect(widgetSeparatorText("powerline-start", "")).toBe("\ue0b2");
    expect(widgetSeparatorText("powerline-end", "")).toBe("\ue0b0");
    expect(widgetSeparatorText(undefined, "")).toBe(" | ");
  });
});
