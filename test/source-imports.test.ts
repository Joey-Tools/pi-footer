import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// pi loads the extension source through jiti. A relative specifier that names the .ts file
// resolves directly; a .js or extensionless specifier makes every module pay for failed
// resolution probes at startup. This guards that performance contract for src/.

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*|\bimport\s*\(\s*|\bexport\s*\*\s*from\s*)["']([^"']+)["']/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

function relativeSpecifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(SPECIFIER_PATTERN)]
    .map((match) => match[1] ?? "")
    .filter((specifier) => specifier.startsWith("./") || specifier.startsWith("../"));
}

describe("source module specifiers", () => {
  const files = sourceFiles(srcDir);

  it("finds the extension sources", () => {
    expect(files).toContain(join(srcDir, "index.ts"));
    expect(files.some((file) => relativeSpecifiers(file).length > 0)).toBe(true);
  });

  it("points every relative import at an existing .ts or .json file", () => {
    const problems = files.flatMap((file) =>
      relativeSpecifiers(file)
        .filter((specifier) => {
          const target = resolve(dirname(file), specifier);
          const directFile = specifier.endsWith(".ts") || specifier.endsWith(".json");
          return !directFile || !existsSync(target) || !statSync(target).isFile();
        })
        .map((specifier) => `${relative(srcDir, file)}: ${specifier}`),
    );
    expect(problems).toEqual([]);
  });
});
