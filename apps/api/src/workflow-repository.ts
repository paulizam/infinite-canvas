import type { WorkflowDefinition } from "@infinite-canvas/contracts";
import type {
  WorkflowCompileIssue,
  WorkflowSourceMapping,
} from "@infinite-canvas/workflow-runtime";

export type WorkflowRecord = {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  currentVersion: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
export type WorkflowVersionRecord = {
  workflowId: string;
  version: number;
  projectRevision: number;
  publicationId: string;
  definition: WorkflowDefinition;
  sourceMapping: WorkflowSourceMapping;
  warnings: WorkflowCompileIssue[];
  publishedBy: string;
  createdAt: string;
};
export type WorkflowPublication = {
  workflow: WorkflowRecord;
  version: WorkflowVersionRecord;
  replayed: boolean;
};

export interface WorkflowRepository {
  publish(input: {
    workflowId: string;
    userId: string;
    workspaceId: string;
    projectId: string;
    projectRevision: number;
    publicationId: string;
    name: string;
    definition: WorkflowDefinition;
    sourceMapping: WorkflowSourceMapping;
    warnings: WorkflowCompileIssue[];
    now: string;
  }): Promise<WorkflowPublication>;
  getForProject(
    userId: string,
    projectId: string,
  ): Promise<WorkflowPublication | null>;
  listVersions(
    userId: string,
    workflowId: string,
  ): Promise<WorkflowVersionRecord[]>;
}

export class MemoryWorkflowRepository implements WorkflowRepository {
  private readonly workflows = new Map<string, WorkflowRecord>();
  private readonly byProject = new Map<string, string>();
  private readonly versions = new Map<string, WorkflowVersionRecord[]>();
  constructor(
    private readonly authorize: (
      userId: string,
      workspaceId: string,
      minimum: "viewer" | "editor",
    ) => Promise<void>,
  ) {}
  async publish(input: Parameters<WorkflowRepository["publish"]>[0]) {
    await this.authorize(input.userId, input.workspaceId, "editor");
    const id = this.byProject.get(input.projectId) || input.workflowId;
    const existingVersions = this.versions.get(id) || [];
    const replay = existingVersions.find(
      (item) =>
        item.publicationId === input.publicationId ||
        item.projectRevision === input.projectRevision,
    );
    if (replay)
      return {
        workflow: this.workflows.get(id)!,
        version: replay,
        replayed: true,
      };
    const current = this.workflows.get(id);
    const version = existingVersions.length + 1;
    const workflow: WorkflowRecord = current
      ? {
          ...current,
          name: input.name,
          currentVersion: version,
          updatedAt: input.now,
        }
      : {
          id,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          name: input.name,
          currentVersion: 1,
          createdBy: input.userId,
          createdAt: input.now,
          updatedAt: input.now,
        };
    const record: WorkflowVersionRecord = {
      workflowId: id,
      version,
      projectRevision: input.projectRevision,
      publicationId: input.publicationId,
      definition: input.definition,
      sourceMapping: input.sourceMapping,
      warnings: input.warnings,
      publishedBy: input.userId,
      createdAt: input.now,
    };
    this.workflows.set(id, workflow);
    this.byProject.set(input.projectId, id);
    existingVersions.push(record);
    this.versions.set(id, existingVersions);
    return { workflow, version: record, replayed: false };
  }
  async getForProject(_userId: string, projectId: string) {
    const id = this.byProject.get(projectId);
    if (!id) return null;
    const workflow = this.workflows.get(id)!;
    const version = this.versions.get(id)!.at(-1)!;
    await this.authorize(_userId, workflow.workspaceId, "viewer");
    return { workflow, version, replayed: false };
  }
  async listVersions(_userId: string, workflowId: string) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return [];
    await this.authorize(_userId, workflow.workspaceId, "viewer");
    return [...(this.versions.get(workflowId) || [])].reverse();
  }
}
