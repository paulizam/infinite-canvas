import type {
  CanvasDocument,
  CanvasMutation,
} from "@infinite-canvas/contracts";

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";
export type UserRecord = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
};
export type PublicUser = Omit<UserRecord, "passwordHash">;
export type SessionRecord = {
  tokenHash: string;
  userId: string;
  expiresAt: string;
};
export type WorkspaceRecord = { id: string; name: string; createdAt: string };
export type MembershipRecord = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
};
export type ProjectRecord = {
  id: string;
  workspaceId: string;
  ownerId: string;
  document: CanvasDocument;
  createdAt: string;
  updatedAt: string;
};
export type MutationResult = { project: ProjectRecord; replayed: boolean };
export type MediaKind = "image" | "video" | "audio";
export type AssetRecord = {
  id: string;
  workspaceId: string;
  ownerId: string;
  storageKey: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  kind: MediaKind;
  originalName: string;
  createdAt: string;
};

export interface PlatformRepository {
  requireWorkspaceRole(
    userId: string,
    workspaceId: string,
    minimum: WorkspaceRole,
  ): Promise<void>;
  createUserWithWorkspace(input: {
    user: UserRecord;
    workspace: WorkspaceRecord;
    membership: MembershipRecord;
  }): Promise<void>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  createSession(session: SessionRecord): Promise<void>;
  findSession(tokenHash: string, now: string): Promise<SessionRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
  listWorkspaces(
    userId: string,
  ): Promise<Array<WorkspaceRecord & { role: WorkspaceRole }>>;
  createWorkspace(
    workspace: WorkspaceRecord,
    membership: MembershipRecord,
  ): Promise<void>;
  listProjects(userId: string, workspaceId: string): Promise<ProjectRecord[]>;
  createProject(userId: string, project: ProjectRecord): Promise<void>;
  deleteProject(userId: string, projectId: string): Promise<void>;
  getProject(userId: string, projectId: string): Promise<ProjectRecord | null>;
  applyProjectMutation(
    userId: string,
    projectId: string,
    mutation: CanvasMutation,
  ): Promise<MutationResult>;
  findAssetByHash(
    userId: string,
    workspaceId: string,
    sha256: string,
  ): Promise<AssetRecord | null>;
  createAsset(userId: string, asset: AssetRecord): Promise<AssetRecord>;
  getAsset(userId: string, assetId: string): Promise<AssetRecord | null>;
  listAssets(userId: string, workspaceId: string): Promise<AssetRecord[]>;
  deleteAsset(userId: string, assetId: string): Promise<AssetRecord>;
}

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 502,
    message: string,
  ) {
    super(message);
  }
}

export function publicUser(user: UserRecord): PublicUser {
  const { passwordHash: _, ...result } = user;
  return result;
}
