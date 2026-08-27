import { randomUUID } from "node:crypto";
import type { WorkflowNodeSchema } from "@infinite-canvas/contracts";
import {
  compileCanvasWorkflow,
  type WorkflowCompileRule,
} from "@infinite-canvas/workflow-runtime";
import { DomainError, type PlatformRepository } from "./domain.js";
import type { WorkflowRepository } from "./workflow-repository.js";

export class WorkflowPublicationService {
  constructor(
    private readonly platform: PlatformRepository,
    private readonly workflows: WorkflowRepository,
  ) {}
  async publish(
    userId: string,
    projectId: string,
    input: {
      publicationId: string;
      expectedProjectRevision: number;
      name?: string;
      entryNodeIds?: string[];
    },
  ) {
    const project = await this.platform.getProject(userId, projectId);
    if (!project) throw new DomainError("PROJECT_NOT_FOUND", 404, "项目不存在");
    await this.platform.requireWorkspaceRole(
      userId,
      project.workspaceId,
      "editor",
    );
    if (project.document.revision !== input.expectedProjectRevision)
      throw new DomainError("REVISION_CONFLICT", 409, "项目版本冲突");
    const existing = await this.workflows.getForProject(userId, projectId);
    const compile = compileCanvasWorkflow(
      project.document,
      BUILTIN_WORKFLOW_RULES,
      {
        workflowId: existing?.workflow.id || randomUUID(),
        name: input.name,
        canvasEntryNodeIds: input.entryNodeIds,
        validation: { availableCapabilities: BUILTIN_CAPABILITIES },
      },
    );
    if (!compile.publishable) return { compile, publication: null };
    const publication = await this.workflows.publish({
      workflowId: compile.definition.id,
      userId,
      workspaceId: project.workspaceId,
      projectId,
      projectRevision: project.document.revision,
      publicationId: input.publicationId,
      name: compile.definition.name,
      definition: compile.definition,
      sourceMapping: compile.sourceMapping,
      warnings: compile.issues.filter((issue) => issue.severity === "warning"),
      now: new Date().toISOString(),
    });
    return publication.replayed
      ? {
          compile: {
            ...compile,
            definition: publication.version.definition,
            sourceMapping: publication.version.sourceMapping,
          },
          publication,
        }
      : { compile, publication };
  }
  async getForProject(userId: string, projectId: string) {
    const project = await this.platform.getProject(userId, projectId);
    if (!project) throw new DomainError("PROJECT_NOT_FOUND", 404, "项目不存在");
    return this.workflows.getForProject(userId, projectId);
  }
  listVersions(userId: string, workflowId: string) {
    return this.workflows.listVersions(userId, workflowId);
  }
}

const BUILTIN_CAPABILITIES = new Set([
  "ai:text",
  "ai:image",
  "ai:video",
  "ai:audio",
]);
const port = (id: string, valueType: string, required = false) => ({
  id,
  valueType,
  required,
});
const schema = (
  type: string,
  inputType: string,
  outputType: string,
  capability?: string,
): WorkflowNodeSchema => ({
  type,
  schemaVersion: 1,
  inputs: [port("input", inputType, Boolean(capability))],
  outputs: [port("output", outputType)],
  ...(capability ? { requiredCapabilities: [capability] } : {}),
});
const passthrough = (
  canvasNodeType: string,
  valueType: string,
): WorkflowCompileRule => ({
  canvasNodeType,
  schema: schema(`canvas.${canvasNodeType}`, valueType, valueType),
  defaultInputPortId: "input",
  defaultOutputPortId: "output",
  configBindings: { value: "content", asset: "assetRef" },
});
const generation = (
  mode: "text" | "image" | "video" | "audio",
  fallback = false,
): WorkflowCompileRule => ({
  canvasNodeType: "config",
  ...(fallback ? {} : { metadataMatch: { generationMode: mode } }),
  schema: schema(
    `ai.generate.${mode}`,
    "string|image|video|audio",
    mode === "text" ? "string" : mode,
    `ai:${mode}`,
  ),
  defaultInputPortId: "input",
  defaultOutputPortId: "output",
  configBindings: {
    input: "prompt",
    prompt: "prompt",
    model: "model",
    reasoningEffort: "reasoningEffort",
    size: "size",
    quality: "quality",
    seconds: "seconds",
    voice: "audioVoice",
  },
});
const condition: WorkflowCompileRule = {
  canvasNodeType: "config",
  metadataMatch: { workflowMode: "condition" },
  schema: {
    type: "logic.condition",
    schemaVersion: 1,
    inputs: [port("input", "string|image|video|audio", true)],
    outputs: [
      port("true", "string|image|video|audio"),
      port("false", "string|image|video|audio"),
    ],
  },
  defaultInputPortId: "input",
  configBindings: { operator: "conditionOperator", compare: "conditionValue" },
};
export const BUILTIN_WORKFLOW_RULES: readonly WorkflowCompileRule[] = [
  passthrough("text", "string"),
  passthrough("image", "image"),
  passthrough("video", "video"),
  passthrough("audio", "audio"),
  condition,
  generation("text"),
  generation("video"),
  generation("audio"),
  generation("image", true),
];
