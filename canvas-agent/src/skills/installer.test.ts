import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SkillInstaller } from "./installer.js";
import { SkillStore, SkillStoreError } from "./store.js";

const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const SOURCE = "https://github.com/acme/skills/tree/main/skills/demo";

test("预览固定 commit、展示文件与权限，并原子安装 provenance", async (context) => {
  const workspace = await temporaryWorkspace(context);
  const content = skill(
    "demo",
    "演示 GitHub Skill",
    "Read project files, then call https://example.com.",
    ["network"],
  );
  const installer = new SkillInstaller(
    new SkillStore(workspace),
    githubFixture([
      { path: "skills/demo/SKILL.md", content },
      { path: "skills/demo/assets/guide.md", content: "guide" },
    ]),
  );

  const preview = await installer.preview(SOURCE);
  assert.equal(preview.source.commitSha, COMMIT);
  assert.equal(preview.skill.name, "demo");
  assert.deepEqual(
    preview.files.map((file) => file.path),
    ["assets/guide.md", "SKILL.md"],
  );
  assert.deepEqual(preview.permissions.declared, ["network"]);
  assert.ok(preview.permissions.inferred.includes("filesystem-read"));
  assert.ok(preview.permissions.inferred.includes("network"));
  const required = [
    ...preview.permissions.declared,
    ...preview.permissions.inferred,
  ];
  const installed = await installer.install({
    previewId: preview.previewId,
    digest: preview.digest,
    confirmedPermissions: required,
  });
  assert.equal(installed.name, "demo");
  assert.equal(
    await fs.readFile(
      path.join(workspace, ".agents", "skills", "demo", "assets", "guide.md"),
      "utf8",
    ),
    "guide",
  );
  const provenance = JSON.parse(
    await fs.readFile(
      path.join(
        workspace,
        ".agents",
        "skills",
        "demo",
        ".infinite-canvas-provenance.json",
      ),
      "utf8",
    ),
  ) as { digest: string; source: { commitSha: string } };
  assert.equal(provenance.digest, preview.digest);
  assert.equal(provenance.source.commitSha, COMMIT);
  await assert.rejects(
    installer.install({
      previewId: preview.previewId,
      digest: preview.digest,
      confirmedPermissions: required,
    }),
    /不存在或已过期/,
  );
});

test("摘要或权限未确认时拒绝并单次消费 preview", async (context) => {
  const workspace = await temporaryWorkspace(context);
  const installer = new SkillInstaller(
    new SkillStore(workspace),
    githubFixture([
      {
        path: "skills/demo/SKILL.md",
        content: skill("demo", "需要 shell", "Run a shell command.", ["shell"]),
      },
    ]),
  );
  const first = await installer.preview(SOURCE);
  await assert.rejects(
    installer.install({
      previewId: first.previewId,
      digest: "0".repeat(64),
      confirmedPermissions: ["shell"],
    }),
    /摘要不匹配/,
  );
  await assert.rejects(
    installer.install({
      previewId: first.previewId,
      digest: first.digest,
      confirmedPermissions: ["shell"],
    }),
    /不存在或已过期/,
  );
  const second = await installer.preview(SOURCE);
  await assert.rejects(
    installer.install({
      previewId: second.previewId,
      digest: second.digest,
      confirmedPermissions: [],
    }),
    /确认全部/,
  );
  await assert.rejects(
    fs.stat(path.join(workspace, ".agents", "skills", "demo")),
    { code: "ENOENT" },
  );
});

test("preview 到期后不可安装", async (context) => {
  const workspace = await temporaryWorkspace(context);
  let now = 1_700_000_000_000;
  const installer = new SkillInstaller(
    new SkillStore(workspace),
    githubFixture([
      {
        path: "skills/demo/SKILL.md",
        content: skill("demo", "到期测试", "Do the task."),
      },
    ]),
    () => now,
  );
  const preview = await installer.preview(SOURCE);
  now += 10 * 60 * 1000;
  await assert.rejects(
    installer.install({
      previewId: preview.previewId,
      digest: preview.digest,
      confirmedPermissions: [],
    }),
    /不存在或已过期/,
  );
});

test("拒绝凭据、query、重定向和非 GitHub 来源", async (context) => {
  const workspace = await temporaryWorkspace(context);
  const store = new SkillStore(workspace);
  const installer = new SkillInstaller(store, githubFixture([]));
  for (const source of [
    "http://github.com/acme/skills/tree/main/x",
    "https://user@github.com/acme/skills/tree/main/x",
    `${SOURCE}?token=x`,
    "https://127.0.0.1/acme/skills/tree/main/x",
  ]) {
    await assert.rejects(
      installer.preview(source),
      (error: unknown) =>
        error instanceof SkillStoreError && error.statusCode === 400,
    );
  }
  const redirected = new SkillInstaller(
    store,
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1" },
      }),
  );
  await assert.rejects(redirected.preview(SOURCE), /重定向/);
});

test("拒绝 traversal、symlink、submodule、缺失或无效 SKILL.md", async (context) => {
  const workspace = await temporaryWorkspace(context);
  const store = new SkillStore(workspace);
  const cases: Array<{ entries: FixtureEntry[]; pattern: RegExp }> = [
    {
      entries: [
        {
          path: "skills/demo/SKILL.md",
          content: skill("demo", "路径测试", "Do it."),
        },
        { path: "skills/demo/../escape", content: "bad" },
      ],
      pattern: /路径无效/,
    },
    {
      entries: [
        {
          path: "skills/demo/SKILL.md",
          content: skill("demo", "链接测试", "Do it."),
          mode: "120000",
        },
      ],
      pattern: /符号链接/,
    },
    {
      entries: [
        {
          path: "skills/demo/module",
          content: "deadbeef",
          mode: "160000",
          type: "commit",
        },
      ],
      pattern: /符号链接或 submodule/,
    },
    {
      entries: [{ path: "skills/demo/readme.md", content: "nothing" }],
      pattern: /SKILL\.md/,
    },
    {
      entries: [
        {
          path: "skills/demo/SKILL.md",
          content: "---\nname: Invalid_Name\ndescription: bad\n---\nbody",
        },
      ],
      pattern: /name 无效/,
    },
  ];
  for (const item of cases)
    await assert.rejects(
      new SkillInstaller(store, githubFixture(item.entries)).preview(SOURCE),
      item.pattern,
    );
});

test("文件限制与同名冲突不会留下 partial tree", async (context) => {
  const workspace = await temporaryWorkspace(context);
  const store = new SkillStore(workspace);
  const tooMany = [
    {
      path: "skills/demo/SKILL.md",
      content: skill("demo", "文件限制", "Do it."),
    },
    ...Array.from({ length: 64 }, (_, index) => ({
      path: `skills/demo/assets/${index}.md`,
      content: "x",
    })),
  ];
  await assert.rejects(
    new SkillInstaller(store, githubFixture(tooMany)).preview(SOURCE),
    /不能超过 64/,
  );
  await store.create({
    name: "demo",
    description: "本地版本",
    instructions: "保留本地内容。",
  });
  const installer = new SkillInstaller(
    store,
    githubFixture([
      {
        path: "skills/demo/SKILL.md",
        content: skill("demo", "远程版本", "Do it."),
      },
    ]),
  );
  const preview = await installer.preview(SOURCE);
  await assert.rejects(
    installer.install({
      previewId: preview.previewId,
      digest: preview.digest,
      confirmedPermissions: preview.permissions.inferred,
    }),
    (error: unknown) =>
      error instanceof SkillStoreError && error.statusCode === 409,
  );
  assert.equal((await store.get("demo")).description, "本地版本");
  const entries = await fs.readdir(path.join(workspace, ".agents", "skills"));
  assert.deepEqual(entries, ["demo"]);
});

type FixtureEntry = {
  path: string;
  content: string | Buffer;
  mode?: string;
  type?: string;
};

function githubFixture(entries: FixtureEntry[]) {
  const withSha = entries.map((entry, index) => ({
    ...entry,
    sha: (index + 1).toString(16).padStart(40, "0"),
    data: Buffer.from(entry.content),
  }));
  return async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/commits/"))
      return json({ sha: COMMIT, commit: { tree: { sha: TREE } } });
    if (url.pathname.includes("/git/trees/"))
      return json({
        truncated: false,
        tree: withSha.map((entry) => ({
          path: entry.path,
          sha: entry.sha,
          mode: entry.mode || "100644",
          type: entry.type || "blob",
          size: entry.data.length,
        })),
      });
    const sha = url.pathname.split("/").at(-1);
    const entry = withSha.find((candidate) => candidate.sha === sha);
    return entry
      ? json({
          encoding: "base64",
          content: entry.data.toString("base64"),
          size: entry.data.length,
        })
      : json({}, 404);
  };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function skill(
  name: string,
  description: string,
  instructions: string,
  permissions: string[] = [],
) {
  return `---\nname: ${name}\ndescription: ${description}${permissions.length ? `\npermissions:\n${permissions.map((permission) => `  - ${permission}`).join("\n")}` : ""}\n---\n${instructions}\n`;
}

async function temporaryWorkspace(context: {
  after: (callback: () => void | Promise<void>) => void;
}) {
  const workspace = await fs.mkdtemp(
    path.join(os.tmpdir(), "canvas-skill-installer-"),
  );
  context.after(() => fs.rm(workspace, { recursive: true, force: true }));
  return workspace;
}
