import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REQUIREMENT_PATTERN = /\b[A-Z]{3}-\d{3}\b/g;
const TEST_TITLE_PATTERN = /\b(?:describe|it|test)\s*\(\s*(["'`])([\s\S]*?)\1/g;

export function parseRequirements(contents) {
  return [
    ...contents.matchAll(
      /^\| ([A-Z]{3}-\d{3}) \| ([^|]+) \| ([^|]+) \| (.+) \|$/gm,
    ),
  ].map((match) => ({
    id: match[1],
    priority: match[2].trim(),
    source: match[3].trim(),
    text: match[4].trim(),
  }));
}

export function extractRequirementIdsFromTestTitles(contents) {
  const ids = [];
  for (const title of contents.matchAll(TEST_TITLE_PATTERN)) {
    for (const id of title[2].matchAll(REQUIREMENT_PATTERN)) ids.push(id[0]);
  }
  return ids;
}

export function collectRequirementTestTraces(requirements) {
  const known = new Set(requirements.map((item) => item.id));
  if (known.size !== requirements.length)
    throw new Error("Requirement IDs must be unique");
  const traces = new Map(requirements.map((item) => [item.id, new Set()]));
  const unknown = new Set();
  const testFiles = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter((path) => /(?:^|\/)[^/]+\.test\.tsx?$/.test(path));

  for (const path of testFiles) {
    const contents = readFileSync(path, "utf8");
    for (const match of contents.matchAll(REQUIREMENT_PATTERN))
      if (!known.has(match[0])) unknown.add(match[0]);
    for (const id of extractRequirementIdsFromTestTitles(contents))
      if (known.has(id)) traces.get(id).add(path);
  }
  if (unknown.size)
    throw new Error(
      `Unknown requirement IDs in tests: ${[...unknown].join(", ")}`,
    );
  return new Map([...traces].map(([id, paths]) => [id, [...paths]]));
}
