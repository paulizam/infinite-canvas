import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const required = [
  "LICENSE",
  "SECURITY.md",
  "CHANGELOG.md",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "docs/architecture/fusion-architecture.md",
  "docs/requirements/functional-spec.md",
  ".env.example",
  "ops/README.md",
];
const missing = required.filter((x) => !existsSync(x));
if (missing.length)
  throw new Error(`Missing release files: ${missing.join(", ")}`);
const version = readFileSync("VERSION", "utf8").trim();
if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
  throw new Error(`Invalid VERSION: ${version}`);
if (
  process.env.GITHUB_REF_TYPE === "tag" &&
  process.env.GITHUB_REF_NAME !== version
)
  throw new Error(
    `Tag ${process.env.GITHUB_REF_NAME} does not match VERSION ${version}`,
  );
if (!readFileSync("CHANGELOG.md", "utf8").includes("## Unreleased"))
  throw new Error("CHANGELOG lacks Unreleased section");
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
if (manifest.name !== "infinite-canvas-fusion")
  throw new Error(`Unexpected product package name: ${manifest.name}`);
if (!/Infinite Canvas|无限画布/.test(readFileSync("README.md", "utf8")))
  throw new Error("README lacks the Infinite Canvas product brand");
for (const name of execFileSync("git", ["ls-files"], {
  encoding: "utf8",
}).split(/\r?\n/))
  if (
    /(^|\/)(\.env|.*\.(pem|key|p12|pfx))$/i.test(name) &&
    name !== ".env.example"
  )
    throw new Error(`Sensitive file is tracked: ${name}`);
if (!process.argv.includes("--allow-dirty")) {
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
  }).trim();
  if (dirty) throw new Error("Release worktree is dirty");
}
console.log(`Release files verified for ${version}`);
