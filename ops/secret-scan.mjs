import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean);
const patterns = [
  ["private key", new RegExp(`-----BEGIN ${"PRIVATE KEY"}-----`)],
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{36,}/],
  ["OpenAI-style key", /sk-[A-Za-z0-9_-]{32,}/],
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
];
const findings = [];
for (const file of files) {
  if (
    file === "ops/secret-scan.mjs" ||
    /(^|\/)(node_modules|dist|\.next)\//.test(file)
  )
    continue;
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch {
    continue;
  }
  if (bytes.includes(0) || bytes.length > 5 * 1024 * 1024) continue;
  const text = bytes.toString("utf8");
  for (const [name, pattern] of patterns) {
    const match = text.match(pattern);
    if (match)
      findings.push(
        `${file}:${text.slice(0, match.index).split("\n").length} ${name}`,
      );
  }
}
if (findings.length) {
  console.error(`Secret scan failed:\n${findings.join("\n")}`);
  process.exit(1);
}
console.log(
  `Secret scan passed (${files.length} tracked/untracked files inspected)`,
);
