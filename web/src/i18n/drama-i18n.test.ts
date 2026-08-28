import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { enDrama, zhDrama } from "./locales/drama";

describe("Drama Studio i18n contract", () => {
    it("[BAS-001][DRM-001] keeps Chinese and English message keys symmetric", () => {
        expect(Object.keys(enDrama).sort()).toEqual(Object.keys(zhDrama).sort());
        expect(Object.values(enDrama).every((value) => value.trim().length > 0 && !/\p{Script=Han}/u.test(value))).toBe(true);
    });

    it("prevents user-visible Chinese literals from returning to Drama pages", () => {
        for (const path of ["src/pages/drama/index.tsx", "src/pages/drama/project.tsx"]) {
            const source = readFileSync(path, "utf8");
            expect(source.match(/["'][^"'\r\n]*\p{Script=Han}[^"'\r\n]*["']/gu) || [], path).toEqual([]);
        }
    });
});
