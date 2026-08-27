import { describe, expect, it } from "vitest";

import { workflowApiCurlSnippet } from "./workflow-api-panel";

describe("workflowApiCurlSnippet", () => {
    it("uses the public endpoint and required replay-safe headers", () => {
        const snippet = workflowApiCurlSnippet("icwf_example", "https://api.example");
        expect(snippet).toContain("https://api.example/api/v1/public/workflows/invoke");
        expect(snippet).toContain("Authorization: Bearer icwf_example");
        expect(snippet).toContain("Idempotency-Key:");
        expect(snippet).toContain("Content-Type: application/json");
    });
});
