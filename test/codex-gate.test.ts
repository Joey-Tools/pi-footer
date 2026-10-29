import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

// Exact canonical assets from Joey-Tools/codex-gated-repo-template at
// 4686f8a02c205ff2f82c995e6ebf180e3eb552ff. A future template refresh needs owner
// review of the new event/permission boundaries before updating these hashes.
const snapshots = [
  [
    ".github/workflows/codex-review-gate.yml",
    "021bed133f7a327d572689514fa1e1e4a63cdee6354bbd3847da787bc61a999e",
  ],
  [
    ".github/workflows/codex-review-gate-controller.yml",
    "be92da0c5e1e283dcc8803b1c518c042e3c9561d26cf53461a6087c1056a8529",
  ],
] as const;

const ruleset = JSON.parse(read("rulesets/codex-review-gate.json"));
const rule = (type: string) => ruleset.rules.find((entry: { type: string }) => entry.type === type);

describe("staged Codex gate configuration", () => {
  for (const [path, digest] of snapshots) {
    it(`preserves the canonical ${path} trust boundary`, () => {
      expect(createHash("sha256").update(read(path)).digest("hex")).toBe(digest);
    });
  }

  it("keeps independent human ownership of the control plane", () => {
    expect(read(".github/CODEOWNERS")).toBe(
      "# BEGIN codex-review-gate control-plane\n" +
        "/.github/workflows/ @JoeyTeng\n" +
        "/.github/CODEOWNERS @JoeyTeng\n" +
        "# END codex-review-gate control-plane\n",
    );
  });

  it("stages the policy disabled for the default branch, without bypass actors", () => {
    expect(ruleset.target).toBe("branch");
    expect(ruleset.enforcement).toBe("disabled");
    expect(ruleset.conditions.ref_name).toEqual({ include: ["~DEFAULT_BRANCH"], exclude: [] });
    expect(ruleset.bypass_actors).toEqual([]);
  });

  it("binds the required native check to GitHub Actions and an up-to-date branch", () => {
    expect(rule("required_status_checks")?.parameters).toEqual({
      required_status_checks: [{ context: "codex/github-review-gate", integration_id: 15368 }],
      strict_required_status_checks_policy: true,
    });
  });

  it("requires owner review, stale approval dismissal and resolved conversations", () => {
    expect(rule("pull_request")?.parameters).toMatchObject({
      dismiss_stale_reviews_on_push: true,
      require_code_owner_review: true,
      required_review_thread_resolution: true,
      required_approving_review_count: 0,
    });
    expect(rule("non_fast_forward")).toBeDefined();
  });
});
