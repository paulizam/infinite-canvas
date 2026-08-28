import assert from "node:assert/strict";
import test from "node:test";

import {
  extractRequirementIdsFromTestTitles,
  parseRequirements,
} from "./requirement-trace-lib.mjs";

test("extracts requirement IDs only from executable test and suite titles", () => {
  const account = ["BAS", "003"].join("-");
  const tenant = ["BAS", "008"].join("-");
  const security = ["OPS", "006"].join("-");
  const bodyOnly = ["CAN", "001"].join("-");
  const contents = `
    // BAS-NNN is only a comment.
    describe("account [${account}]", () => {
      it("keeps tenant boundaries [${tenant}] [${security}]", () => {
        const diagnostic = "${bodyOnly} in a test body is not direct evidence";
      });
    });
  `;
  assert.deepEqual(extractRequirementIdsFromTestTitles(contents), [
    account,
    tenant,
    security,
  ]);
});

test("parses requirement metadata from the functional specification table", () => {
  const bas = ["BAS", "001"].join("-");
  const gen = ["GEN", "001"].join("-");
  const requirements = parseRequirements(
    `| ${bas} | P0 | I/N | Theme and locale. |\n| ${gen} | P1 | V | Streaming text. |`,
  );
  assert.deepEqual(requirements, [
    { id: bas, priority: "P0", source: "I/N", text: "Theme and locale." },
    { id: gen, priority: "P1", source: "V", text: "Streaming text." },
  ]);
});
