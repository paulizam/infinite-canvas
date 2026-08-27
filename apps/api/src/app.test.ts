import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { MemoryPlatformRepository } from "./memory-repository.js";
import {
  IdentityService,
  ProjectService,
  WorkspaceService,
} from "./services.js";

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  const repository = new MemoryPlatformRepository();
  app = createApp({
    identity: new IdentityService(repository, 60_000),
    workspaces: new WorkspaceService(repository),
    projects: new ProjectService(repository),
    secureCookies: false,
  });
});

async function register(email = "creator@example.com", name = "创作者") {
  const response = await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "test-password", name }),
  });
  const body = (await response.json()) as {
    data: { user: { id: string }; workspace: { id: string } };
  };
  return {
    response,
    body,
    cookie: response.headers.get("set-cookie")!.split(";")[0]!,
  };
}

describe("cloud workspace API", () => {
  it("registers, authenticates and logs out a session", async () => {
    const { response, body, cookie } = await register();
    expect(response.status).toBe(201);
    expect(body.data.user.id).toBeTruthy();
    const me = await app.request("/api/v1/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    const logout = await app.request("/api/v1/auth/logout", {
      method: "POST",
      headers: { cookie },
    });
    expect(logout.status).toBe(200);
    expect(
      (await app.request("/api/v1/me", { headers: { cookie } })).status,
    ).toBe(401);
  });
  it("creates a project and applies an idempotent revision mutation", async () => {
    const { body, cookie } = await register();
    const created = await app.request(
      `/api/v1/workspaces/${body.data.workspace.id}/projects`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "云画布" }),
      },
    );
    const project = (
      (await created.json()) as {
        data: { id: string; document: { revision: number } };
      }
    ).data;
    expect(project.document.revision).toBe(0);
    const mutation = {
      mutationId: "m1",
      projectId: project.id,
      baseRevision: 0,
      clientId: "tab-1",
      createdAt: new Date().toISOString(),
      operations: [{ type: "document.patch", patch: { title: "新标题" } }],
    };
    const first = await app.request(
      `/api/v1/projects/${project.id}/mutations`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(mutation),
      },
    );
    const firstData = (
      (await first.json()) as {
        data: {
          project: { document: { revision: number; title: string } };
          replayed: boolean;
        };
      }
    ).data;
    expect(firstData.project.document).toMatchObject({
      revision: 1,
      title: "新标题",
    });
    expect(firstData.replayed).toBe(false);
    const replay = await app.request(
      `/api/v1/projects/${project.id}/mutations`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(mutation),
      },
    );
    expect(
      ((await replay.json()) as { data: { replayed: boolean } }).data.replayed,
    ).toBe(true);
    const conflict = { ...mutation, mutationId: "m2" };
    expect(
      (
        await app.request(`/api/v1/projects/${project.id}/mutations`, {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify(conflict),
        })
      ).status,
    ).toBe(409);
  });
  it("prevents cross-workspace project access", async () => {
    const owner = await register();
    const created = await app.request(
      `/api/v1/workspaces/${owner.body.data.workspace.id}/projects`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "私有" }),
      },
    );
    const id = ((await created.json()) as { data: { id: string } }).data.id;
    const outsider = await register("other@example.com", "其他人");
    expect(
      (
        await app.request(`/api/v1/projects/${id}`, {
          headers: { cookie: outsider.cookie },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          `/api/v1/workspaces/${owner.body.data.workspace.id}/projects`,
          { headers: { cookie: outsider.cookie } },
        )
      ).status,
    ).toBe(403);
  });
  it("returns validation errors as 400", async () =>
    expect(
      (
        await app.request("/api/v1/auth/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(400));
});
