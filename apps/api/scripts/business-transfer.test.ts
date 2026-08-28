import { describe, expect, it } from "vitest";
import { sanitizeValue } from "./business-transfer.mjs";

describe("business transfer sanitization", () => {
  it("redacts nested secrets without destroying business content", () => {
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
});
