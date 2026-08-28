import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { navigationTools } from "@/constant/navigation-tools";
import enUS from "@/i18n/locales/en-US";
import zhCN from "@/i18n/locales/zh-CN";

describe("[BAS-001] responsive bilingual application shell", () => {
    it("keeps every critical product route reachable in both desktop and mobile navigation", () => {
        expect(navigationTools.map((tool) => tool.slug)).toEqual(["canvas", "image", "video", "prompts", "drama", "assets", "config"]);
        for (const { slug } of navigationTools) {
            expect(zhCN.navigation[slug]).toBeTruthy();
            expect(enUS.navigation[slug]).toBeTruthy();
        }

        const desktop = readFileSync("src/components/layout/app-top-nav.tsx", "utf8");
        const mobile = readFileSync("src/components/layout/mobile-nav-drawer.tsx", "utf8");
        expect(desktop).toContain('className="ml-3 inline-flex size-8');
        expect(desktop).toContain("md:hidden");
        expect(desktop).toContain("md:flex");
        expect(desktop).toContain("<MobileNavDrawer");
        expect(mobile).toContain("navigationTools.map");
        expect(mobile).toContain("onClick={onClose}");
        expect(mobile).toContain('className="md:hidden"');
    });
});
