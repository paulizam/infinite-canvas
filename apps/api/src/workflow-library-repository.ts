import { DomainError } from "./domain.js";

export type WorkflowFolder = {
  id: string;
  workspaceId: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
export type WorkflowLibraryMetadata = {
  workflowId: string;
  workspaceId: string;
  folderId: string | null;
  coverAssetId: string | null;
  description: string;
  tags: string[];
  isTemplate: boolean;
  updatedAt: string;
};
export interface WorkflowLibraryRepository {
  createFolder(folder: WorkflowFolder): Promise<WorkflowFolder>;
  listFolders(userId: string, workspaceId: string): Promise<WorkflowFolder[]>;
  deleteFolder(userId: string, folderId: string): Promise<void>;
  listMetadata(
    userId: string,
    workspaceId: string,
  ): Promise<WorkflowLibraryMetadata[]>;
  upsertMetadata(
    userId: string,
    metadata: WorkflowLibraryMetadata,
  ): Promise<WorkflowLibraryMetadata>;
}

export class MemoryWorkflowLibraryRepository implements WorkflowLibraryRepository {
  private readonly folders = new Map<string, WorkflowFolder>();
  private readonly metadata = new Map<string, WorkflowLibraryMetadata>();
  constructor(
    private readonly authorize: (
      userId: string,
      workspaceId: string,
      minimum: "viewer" | "editor",
    ) => Promise<void>,
  ) {}
  async createFolder(folder: WorkflowFolder) {
    await this.authorize(folder.createdBy, folder.workspaceId, "editor");
    if (
      [...this.folders.values()].some(
        (item) =>
          item.workspaceId === folder.workspaceId &&
          item.name.toLowerCase() === folder.name.toLowerCase(),
      )
    )
      throw new DomainError("FOLDER_EXISTS", 409, "同名文件夹已存在");
    this.folders.set(folder.id, structuredClone(folder));
    return structuredClone(folder);
  }
  async listFolders(userId: string, workspaceId: string) {
    await this.authorize(userId, workspaceId, "viewer");
    return [...this.folders.values()]
      .filter((item) => item.workspaceId === workspaceId)
      .map((item) => structuredClone(item));
  }
  async deleteFolder(userId: string, folderId: string) {
    const folder = this.folders.get(folderId);
    if (!folder) throw new DomainError("FOLDER_NOT_FOUND", 404, "文件夹不存在");
    await this.authorize(userId, folder.workspaceId, "editor");
    this.folders.delete(folderId);
    for (const item of this.metadata.values())
      if (item.folderId === folderId) item.folderId = null;
  }
  async listMetadata(userId: string, workspaceId: string) {
    await this.authorize(userId, workspaceId, "viewer");
    return [...this.metadata.values()]
      .filter((item) => item.workspaceId === workspaceId)
      .map((item) => structuredClone(item));
  }
  async upsertMetadata(userId: string, metadata: WorkflowLibraryMetadata) {
    await this.authorize(userId, metadata.workspaceId, "editor");
    if (
      metadata.folderId &&
      this.folders.get(metadata.folderId)?.workspaceId !== metadata.workspaceId
    )
      throw new DomainError("FOLDER_NOT_FOUND", 404, "文件夹不存在");
    this.metadata.set(metadata.workflowId, structuredClone(metadata));
    return structuredClone(metadata);
  }
}
