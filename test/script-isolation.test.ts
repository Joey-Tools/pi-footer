import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

// The runtime helper is plain ESM so it is also usable by standalone Node smoke/benchmark runs.
// @ts-expect-error Standalone .mjs validation helpers intentionally have no declaration files.
import { createRunDir } from "../scripts/lib/pi-host.mjs";

describe("validation artifact isolation", () => {
  it("creates a fresh run beneath a retained parent without modifying old artifacts", () => {
    const parent = mkdtempSync(join(tmpdir(), "pi-footer-script-test-"));
    try {
      const first: string = createRunDir(parent, "run-");
      writeFileSync(join(first, "cached-result"), "previous run");
      const second: string = createRunDir(parent, "run-");

      expect(first).not.toBe(second);
      expect(dirname(first)).toBe(parent);
      expect(dirname(second)).toBe(parent);
      expect(readdirSync(second)).toEqual([]);
      expect(readFileSync(join(first, "cached-result"), "utf8")).toBe("previous run");
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
