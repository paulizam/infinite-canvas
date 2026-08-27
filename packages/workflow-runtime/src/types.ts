import type { WorkflowDefinition } from "@infinite-canvas/contracts";

export type WorkflowValidationCode =
  | "EMPTY_WORKFLOW"
  | "DUPLICATE_NODE_ID"
  | "DUPLICATE_EDGE_ID"
  | "DUPLICATE_PORT_ID"
  | "UNKNOWN_NODE_TYPE"
  | "UNKNOWN_EDGE_NODE"
  | "UNKNOWN_EDGE_PORT"
  | "SELF_EDGE"
  | "TYPE_MISMATCH"
  | "MULTIPLE_INPUT"
  | "MISSING_REQUIRED_INPUT"
  | "CYCLE"
  | "UNKNOWN_ENTRY_NODE"
  | "UNREACHABLE_NODE"
  | "MISSING_CAPABILITY"
  | "MISSING_CREDENTIAL";

export type WorkflowValidationIssue = {
  code: WorkflowValidationCode;
  severity: "error" | "warning";
  message: string;
  nodeId?: string;
  edgeId?: string;
  portId?: string;
};

export type WorkflowValidationOptions = {
  knownNodeTypes?: ReadonlySet<string>;
  availableCapabilities?: ReadonlySet<string>;
  availableCredentials?: ReadonlySet<string>;
  entryNodeIds?: readonly string[];
  unreachableSeverity?: "error" | "warning";
};

export type WorkflowValidationResult = {
  valid: boolean;
  issues: WorkflowValidationIssue[];
  layers: string[][];
};

export type WorkflowExecutionPlan = {
  definitionId: string;
  selectedNodeIds: string[];
  layers: string[][];
  skipped: Array<{ nodeId: string; reason: "before_selection" }>;
};

export class WorkflowValidationError extends Error {
  constructor(public readonly result: WorkflowValidationResult) {
    super(
      result.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => `${issue.code}:${issue.message}`)
        .join("; "),
    );
    this.name = "WorkflowValidationError";
  }
}

export type { WorkflowDefinition };
