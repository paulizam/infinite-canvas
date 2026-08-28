import crypto from "node:crypto";

import matter from "gray-matter";

import {
  SkillStore,
  SkillStoreError,
  type InstallManagedSkillFile,
  type ManagedSkillDetail,
} from "./store.js";

const MAX_FILES = 64;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED_PREVIEWS = 32;
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type SkillPermission =
  | "filesystem-read"
  | "filesystem-write"
  | "network"
  | "shell"
  | "mcp"
  | "paid-generation";
export type SkillInstallPreview = {
  previewId: string;
  source: {
    url: string;
    provider: "github";
    owner: string;
    repo: string;
    ref: string;
    path: string;
    commitSha: string;
  };
  skill: { name: string; description: string };
  files: Array<{ path: string; bytes: number; sha256: string }>;
  permissions: {
    declared: string[];
    inferred: SkillPermission[];
    evidence: string[];
  };
  digest: string;
  expiresAt: string;
};

export type SkillSearchResult = { name: string; repository: string; description: string; sourceUrl: string };

type CachedPreview = {
  preview: SkillInstallPreview;
  files: InstallManagedSkillFile[];
  expiresAt: number;
};
type GitTreeEntry = {
  path?: string;
  mode?: string;
  type?: string;
  sha?: string;
  size?: number;
};
type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class SkillInstaller {
  private readonly previews = new Map<string, CachedPreview>();

  constructor(
    private readonly store: SkillStore,
    private readonly fetcher: Fetcher = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** 在 GitHub 仓库索引中检索实际包含 SKILL.md 的目录，结果仍需走 preview 安全门。 */
  async search(queryValue: unknown): Promise<SkillSearchResult[]> {
    const query = typeof queryValue === "string" ? queryValue.trim() : "";
    if (query.length < 2 || query.length > 100 || /[\u0000-\u001f\u007f]/.test(query))
      throw new SkillStoreError("Skill 搜索词长度必须为 2–100 个字符", 400);
    const result = await this.githubJson<{ items?: Array<{ full_name?: string; description?: string | null; default_branch?: string }> }>(
      `/search/repositories?q=${encodeURIComponent(`${query} skill in:name,description,readme`)}&sort=stars&order=desc&per_page=5`,
    );
    const found: SkillSearchResult[] = [];
    for (const repository of result.items || []) {
      const [owner, repo] = String(repository.full_name || "").split("/");
      const branch = String(repository.default_branch || "");
      if (!owner || !repo || !branch || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) continue;
      const tree = await this.githubJson<{ tree?: GitTreeEntry[]; truncated?: boolean }>(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
      if (tree.truncated) continue;
      for (const entry of tree.tree || []) {
        if (entry.type !== "blob" || !(entry.path === "SKILL.md" || entry.path?.endsWith("/SKILL.md"))) continue;
        const directory = entry.path === "SKILL.md" ? "" : entry.path!.slice(0, -"/SKILL.md".length);
        found.push({ name: directory.split("/").pop() || repo, repository: `${owner}/${repo}`, description: String(repository.description || ""), sourceUrl: directory ? `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(branch)}/${directory}` : `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/SKILL.md` });
        if (found.length >= 12) return found;
      }
    }
    return found;
  }

  /** 获取固定到 commit SHA 的文件与权限清单；此阶段不写磁盘，也不执行远程内容。 */
  async preview(sourceUrlValue: unknown): Promise<SkillInstallPreview> {
    this.prune();
    const requested = parseGitHubSource(sourceUrlValue);
    const commit = await this.githubJson<{
      sha?: string;
      commit?: { tree?: { sha?: string } };
    }>(
      `/repos/${requested.owner}/${requested.repo}/commits/${encodeURIComponent(requested.ref)}`,
    );
    const commitSha = String(commit.sha || "");
    const treeSha = String(commit.commit?.tree?.sha || "");
    if (!/^[a-f0-9]{40}$/i.test(commitSha) || !/^[a-f0-9]{40}$/i.test(treeSha))
      throw new SkillStoreError("GitHub 未返回有效 commit", 409);
    const tree = await this.githubJson<{
      tree?: GitTreeEntry[];
      truncated?: boolean;
    }>(
      `/repos/${requested.owner}/${requested.repo}/git/trees/${treeSha}?recursive=1`,
    );
    if (tree.truncated)
      throw new SkillStoreError("远程仓库文件树过大，无法安全预览", 400);
    const entries = selectSkillEntries(tree.tree || [], requested.path);
    if (!entries.length)
      throw new SkillStoreError("来源路径中没有可安装文件", 404);
    if (entries.length > MAX_FILES)
      throw new SkillStoreError(`Skill 文件不能超过 ${MAX_FILES} 个`, 400);
    let total = 0;
    for (const entry of entries) {
      if (
        entry.type !== "blob" ||
        entry.mode === "120000" ||
        entry.mode === "160000" ||
        !entry.sha
      )
        throw new SkillStoreError("Skill 不能包含符号链接或 submodule", 400);
      if ((entry.size || 0) > MAX_FILE_BYTES)
        throw new SkillStoreError("Skill 单个文件不能超过 512KiB", 400);
      total += entry.size || 0;
    }
    if (total > MAX_TOTAL_BYTES)
      throw new SkillStoreError("Skill 文件总量不能超过 2MiB", 400);

    const files: InstallManagedSkillFile[] = [];
    for (const entry of entries) {
      const blob = await this.githubJson<{
        content?: string;
        encoding?: string;
        size?: number;
      }>(`/repos/${requested.owner}/${requested.repo}/git/blobs/${entry.sha}`);
      if (blob.encoding !== "base64" || typeof blob.content !== "string")
        throw new SkillStoreError("GitHub 文件编码无效", 409);
      const content = Buffer.from(blob.content.replace(/\s/g, ""), "base64");
      if (
        content.length > MAX_FILE_BYTES ||
        content.length !== Number(blob.size ?? content.length)
      )
        throw new SkillStoreError("GitHub 文件大小校验失败", 409);
      total += entry.size ? 0 : content.length;
      if (total > MAX_TOTAL_BYTES)
        throw new SkillStoreError("Skill 文件总量不能超过 2MiB", 400);
      files.push({
        path: relativeEntryPath(entry.path || "", requested.path),
        content,
      });
    }
    const skillDocument = files.find((file) => file.path === "SKILL.md");
    if (!skillDocument)
      throw new SkillStoreError("Skill 根目录必须包含 SKILL.md", 400);
    const parsed = parseSkill(skillDocument.content);
    const permissions = inspectPermissions(parsed.frontmatter, files);
    const source = {
      url: requested.url,
      provider: "github" as const,
      owner: requested.owner,
      repo: requested.repo,
      ref: requested.ref,
      path: requested.path,
      commitSha: commitSha.toLowerCase(),
    };
    const fileManifest = files
      .map((file) => ({
        path: file.path,
        bytes: file.content.length,
        sha256: sha256(file.content),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
    const digest = sha256(
      Buffer.from(
        JSON.stringify({
          source,
          skill: parsed.skill,
          files: fileManifest,
          permissions,
        }),
        "utf8",
      ),
    );
    const previewId = crypto.randomUUID();
    const expiresAtValue = this.now() + PREVIEW_TTL_MS;
    const preview: SkillInstallPreview = {
      previewId,
      source,
      skill: parsed.skill,
      files: fileManifest,
      permissions,
      digest,
      expiresAt: new Date(expiresAtValue).toISOString(),
    };
    while (this.previews.size >= MAX_CACHED_PREVIEWS) {
      this.previews.delete(this.previews.keys().next().value as string);
    }
    this.previews.set(previewId, { preview, files, expiresAt: expiresAtValue });
    return preview;
  }

  /** 只消费一次 preview，校验摘要与权限确认后原子落盘。 */
  async install(input: unknown): Promise<ManagedSkillDetail> {
    this.prune();
    const value =
      input && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};
    const previewId =
      typeof value.previewId === "string" ? value.previewId : "";
    const cached = this.previews.get(previewId);
    if (!cached)
      throw new SkillStoreError("安装预览不存在或已过期，请重新预览", 409);
    this.previews.delete(previewId);
    if (value.digest !== cached.preview.digest)
      throw new SkillStoreError("安装内容摘要不匹配，请重新预览", 409);
    const confirmed = Array.isArray(value.confirmedPermissions)
      ? new Set(
          value.confirmedPermissions.filter(
            (item): item is string => typeof item === "string",
          ),
        )
      : new Set<string>();
    const required = [
      ...cached.preview.permissions.declared,
      ...cached.preview.permissions.inferred,
    ];
    if (required.some((permission) => !confirmed.has(permission)))
      throw new SkillStoreError("必须确认全部声明及推断权限后才能安装", 400);
    const provenance = Buffer.from(
      `${JSON.stringify({ source: cached.preview.source, digest: cached.preview.digest, permissions: cached.preview.permissions, installedAt: new Date(this.now()).toISOString() }, null, 2)}\n`,
      "utf8",
    );
    return this.store.install(cached.preview.skill.name, [
      ...cached.files,
      { path: ".infinite-canvas-provenance.json", content: provenance },
    ]);
  }

  private prune() {
    const current = this.now();
    for (const [id, cached] of this.previews)
      if (cached.expiresAt <= current) this.previews.delete(id);
  }

  private async githubJson<T>(pathname: string): Promise<T> {
    const url = `https://api.github.com${pathname}`;
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const response = await this.fetcher(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "infinite-canvas-skill-installer",
        "x-github-api-version": "2022-11-28",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (response.status >= 300 && response.status < 400)
      throw new SkillStoreError("GitHub 重定向被安全策略拒绝", 400);
    if (response.url) {
      const finalUrl = new URL(response.url);
      if (
        finalUrl.protocol !== "https:" ||
        finalUrl.hostname !== "api.github.com"
      )
        throw new SkillStoreError("GitHub 响应来源不安全", 400);
    }
    if (!response.ok)
      throw new SkillStoreError(
        response.status === 404
          ? "找不到 GitHub 来源或无权访问"
          : `GitHub 请求失败（HTTP ${response.status}）`,
        response.status === 404 ? 404 : 409,
      );
    return (await response.json()) as T;
  }
}

function parseGitHubSource(value: unknown) {
  if (typeof value !== "string" || value.length > 2048)
    throw new SkillStoreError("请输入有效的 GitHub Skill URL", 400);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SkillStoreError("请输入有效的 GitHub Skill URL", 400);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    throw new SkillStoreError(
      "只允许不含凭据、参数和片段的 GitHub HTTPS URL",
      400,
    );
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        throw new SkillStoreError("GitHub URL 编码无效", 400);
      }
    });
  const [owner, repoValue, kind, refValue, ...pathSegments] = segments;
  const repo = repoValue?.replace(/\.git$/i, "");
  if (
    !owner ||
    !repo ||
    !/^[A-Za-z0-9_.-]+$/.test(owner) ||
    !/^[A-Za-z0-9_.-]+$/.test(repo)
  )
    throw new SkillStoreError("GitHub 仓库地址无效", 400);
  if (kind !== "tree" && kind !== "blob")
    throw new SkillStoreError(
      "GitHub URL 必须指向仓库中的 Skill 目录或 SKILL.md",
      400,
    );
  if (!refValue || !pathSegments.length)
    throw new SkillStoreError("GitHub URL 缺少 ref 或 Skill 路径", 400);
  const unsafe = [refValue, ...pathSegments].some(
    (segment) =>
      !segment ||
      segment === "." ||
      segment === ".." ||
      segment.includes("\\") ||
      segment.includes("\0"),
  );
  if (unsafe) throw new SkillStoreError("GitHub Skill 路径无效", 400);
  let sourcePath = pathSegments.join("/");
  if (kind === "blob") {
    if (!sourcePath.endsWith("/SKILL.md") && sourcePath !== "SKILL.md")
      throw new SkillStoreError("GitHub blob URL 必须指向 SKILL.md", 400);
    sourcePath =
      sourcePath === "SKILL.md" ? "" : sourcePath.slice(0, -"/SKILL.md".length);
  }
  return { url: url.toString(), owner, repo, ref: refValue, path: sourcePath };
}

function selectSkillEntries(tree: GitTreeEntry[], root: string) {
  const prefix = root ? `${root}/` : "";
  const descendants = tree.filter(
    (entry) =>
      typeof entry.path === "string" &&
      entry.path.startsWith(prefix) &&
      entry.path.length > prefix.length,
  );
  if (
    descendants.some(
      (entry) =>
        entry.path!.includes("\\") ||
        entry.path!.includes("\0") ||
        entry
          .path!.slice(prefix.length)
          .split("/")
          .some((part) => !part || part === "." || part === ".."),
    )
  ) {
    throw new SkillStoreError("GitHub 文件路径无效", 400);
  }
  return descendants.filter((entry) => entry.type !== "tree");
}

function relativeEntryPath(entryPath: string, root: string) {
  const relative = root ? entryPath.slice(root.length + 1) : entryPath;
  if (
    !relative ||
    relative.includes("\\") ||
    relative.includes("\0") ||
    relative.startsWith("/") ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new SkillStoreError("GitHub 文件路径无效", 400);
  return relative;
}

function parseSkill(content: Buffer) {
  if (content.length > 256 * 1024)
    throw new SkillStoreError("SKILL.md 不能超过 256KiB", 400);
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content.toString("utf8"));
  } catch {
    throw new SkillStoreError("SKILL.md frontmatter 格式无效", 400);
  }
  const frontmatter =
    parsed.data &&
    typeof parsed.data === "object" &&
    !Array.isArray(parsed.data)
      ? (parsed.data as Record<string, unknown>)
      : {};
  const name = typeof frontmatter.name === "string" ? frontmatter.name : "";
  const description =
    typeof frontmatter.description === "string"
      ? frontmatter.description.trim()
      : "";
  if (!NAME_PATTERN.test(name) || name.length > 64)
    throw new SkillStoreError("SKILL.md name 无效", 400);
  if (!description || description.length > 1024 || /[<>]/.test(description))
    throw new SkillStoreError("SKILL.md description 无效", 400);
  if (!parsed.content.trim())
    throw new SkillStoreError("SKILL.md 正文不能为空", 400);
  return { frontmatter, skill: { name, description } };
}

function inspectPermissions(
  frontmatter: Record<string, unknown>,
  files: InstallManagedSkillFile[],
) {
  const declaredValue = frontmatter.permissions;
  const declared = [
    ...new Set(
      Array.isArray(declaredValue)
        ? declaredValue
            .filter(
              (value): value is string =>
                typeof value === "string" && Boolean(value.trim()),
            )
            .map((value) => value.trim())
        : declaredValue && typeof declaredValue === "object"
          ? Object.entries(declaredValue as Record<string, unknown>)
              .filter(([, enabled]) => Boolean(enabled))
              .map(([name]) => name)
          : typeof declaredValue === "string" && declaredValue.trim()
            ? [declaredValue.trim()]
            : [],
    ),
  ].sort();
  const textFiles = files.filter((file) =>
    /\.(?:md|ya?ml|json|js|mjs|cjs|ts|tsx|py|sh|ps1)$/i.test(file.path),
  );
  const rules: Array<[SkillPermission, RegExp]> = [
    [
      "shell",
      /\b(?:shell|bash|powershell|cmd\.exe|spawn|exec(?:ute)?|run command)\b/i,
    ],
    [
      "network",
      /\b(?:https?:\/\/|fetch\(|curl\b|wget\b|network|api request)\b/i,
    ],
    [
      "filesystem-write",
      /\b(?:write|edit|modify|delete|remove|rename|create file|filesystem-write)\b/i,
    ],
    [
      "filesystem-read",
      /\b(?:read|list files?|glob|grep|search files?|filesystem-read)\b/i,
    ],
    ["mcp", /\b(?:mcp__|mcp server|model context protocol)\b/i],
    [
      "paid-generation",
      /\b(?:image generation|generate image|text-to-image|paid-generation)\b/i,
    ],
  ];
  const inferred: SkillPermission[] = [];
  const evidence: string[] = [];
  for (const [permission, pattern] of rules) {
    const matched = textFiles.find((file) =>
      pattern.test(
        file.content.toString(
          "utf8",
          0,
          Math.min(file.content.length, 256 * 1024),
        ),
      ),
    );
    if (matched) {
      inferred.push(permission);
      evidence.push(`${permission}: ${matched.path}`);
    }
  }
  return { declared, inferred, evidence };
}

function sha256(value: Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
