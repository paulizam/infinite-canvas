import { readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("bundled plugin catalog [PLG-002]", () => {
    it("ships every required built-in node bundle", async () => {
        const root = new URL("../../../public/plugins/", import.meta.url);
        const catalog = JSON.parse(await readFile(new URL("index.json", root), "utf8")) as string[];
        const required = ["html", "markdown", "svg", "panorama", "sticky-note"];
        expect(catalog).toEqual(expect.arrayContaining(required.map((id) => `/plugins/${id}.js`)));
        for (const id of required) expect((await stat(new URL(`${id}.js`, root))).size).toBeGreaterThan(100);
    });
});
