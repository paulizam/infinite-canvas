import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sanitizeValue } from "./business-transfer.mjs";

describe("business transfer sanitization", () => {
  it("redacts nested secrets without destroying business content [OPS-003]", () => {
    expect(
      sanitizeValue({
        prompt: "keep",
        apiKey: "hide",
        nested: [{ authorization: "hide", cost: 2 }],
      }),
    ).toEqual({
      prompt: "keep",
      apiKey: "[REDACTED]",
      nested: [{ authorization: "[REDACTED]", cost: 2 }],
    });
  });

  it("pins deploy, environment, supply-chain and release gates [OPS-001] [OPS-002] [OPS-007] [OPS-010]", () => {
    const root = new URL("../../../", import.meta.url);
    const compose = readFileSync(new URL("docker-compose.yml", root), "utf8");
    const packageJson = readFileSync(new URL("package.json", root), "utf8");
    const workflow = readFileSync(
      new URL(".github/workflows/quality-security.yml", root),
      "utf8",
    );
    expect(compose).toMatch(/healthcheck:/);
    expect(compose).toMatch(/api:/);
    expect(compose).toMatch(/worker:/);
    expect(packageJson).toContain('"release:check"');
    expect(workflow).toMatch(/trivy/i);
    expect(workflow).toMatch(/anchore\/sbom-action/i);
    expect(workflow).toMatch(/spdx-json/i);
    expect(workflow).toMatch(/secret/i);
  });
});
