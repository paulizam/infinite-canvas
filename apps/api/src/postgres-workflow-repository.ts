import pg from "pg";
import { DomainError } from "./domain.js";
import type {
  WorkflowRepository,
  WorkflowVersionRecord,
} from "./workflow-repository.js";

export class PostgresWorkflowRepository implements WorkflowRepository {
  private readonly pool: pg.Pool;
  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }
  async publish(input: Parameters<WorkflowRepository["publish"]>[0]) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const project = await client.query(
        `SELECT p.* FROM canvas_projects p JOIN workspace_members m ON m.workspace_id=p.workspace_id
         WHERE p.id=$1 AND p.workspace_id=$2 AND m.user_id=$3 AND m.role IN ('owner','admin','editor') FOR UPDATE OF p`,
        [input.projectId, input.workspaceId, input.userId],
      );
      if (!project.rows[0])
        throw new DomainError("PROJECT_NOT_FOUND", 404, "项目不存在");
      if (Number(project.rows[0].revision) !== input.projectRevision)
        throw new DomainError("REVISION_CONFLICT", 409, "项目版本冲突");
      let workflow = await client.query(
        "SELECT * FROM workflows WHERE project_id=$1 FOR UPDATE",
        [input.projectId],
      );
      const creating = !workflow.rows[0];
      if (creating)
        workflow = await client.query(
          `INSERT INTO workflows(id,workspace_id,project_id,name,current_version,created_by,created_at,updated_at)
         VALUES($1,$2,$3,$4,1,$5,$6,$6) RETURNING *`,
          [
            input.workflowId,
            input.workspaceId,
            input.projectId,
            input.name,
            input.userId,
            input.now,
          ],
        );
      const id = String(workflow.rows[0].id);
      const replay = await client.query(
        "SELECT * FROM workflow_versions WHERE workflow_id=$1 AND (publication_id=$2 OR project_revision=$3) ORDER BY version LIMIT 1",
        [id, input.publicationId, input.projectRevision],
      );
      if (replay.rows[0]) {
        await client.query("COMMIT");
        return {
          workflow: mapWorkflow(workflow.rows[0]),
          version: mapVersion(replay.rows[0]),
          replayed: true,
        };
      }
      const version = creating
        ? 1
        : Number(workflow.rows[0].current_version) + 1;
      const inserted = await client.query(
        `INSERT INTO workflow_versions(workflow_id,version,project_revision,publication_id,definition,source_mapping,warnings,published_by,created_at)
         VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9) RETURNING *`,
        [
          id,
          version,
          input.projectRevision,
          input.publicationId,
          JSON.stringify(input.definition),
          JSON.stringify(input.sourceMapping),
          JSON.stringify(input.warnings),
          input.userId,
          input.now,
        ],
      );
      const updated = await client.query(
        "UPDATE workflows SET name=$2,current_version=$3,updated_at=$4 WHERE id=$1 RETURNING *",
        [id, input.name, version, input.now],
      );
      await client.query("COMMIT");
      return {
        workflow: mapWorkflow(updated.rows[0]),
        version: mapVersion(inserted.rows[0]),
        replayed: false,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async getForProject(userId: string, projectId: string) {
    const result = await this.pool.query(
      `SELECT w.id,w.workspace_id,w.project_id,w.name,w.current_version,w.created_by,
       w.created_at AS workflow_created_at,w.updated_at AS workflow_updated_at,v.*
       FROM workflows w JOIN workspace_members m ON m.workspace_id=w.workspace_id
       JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=w.current_version WHERE w.project_id=$1 AND m.user_id=$2`,
      [projectId, userId],
    );
    return result.rows[0]
      ? {
          workflow: mapWorkflow(result.rows[0], "workflow_"),
          version: mapVersion(result.rows[0]),
          replayed: false,
        }
      : null;
  }
  async listVersions(userId: string, workflowId: string) {
    const result = await this.pool.query(
      `SELECT v.* FROM workflow_versions v JOIN workflows w ON w.id=v.workflow_id
       JOIN workspace_members m ON m.workspace_id=w.workspace_id WHERE v.workflow_id=$1 AND m.user_id=$2 ORDER BY v.version DESC`,
      [workflowId, userId],
    );
    return result.rows.map(mapVersion);
  }
  async getById(userId: string, workflowId: string) {
    const result = await this.pool.query(
      `SELECT w.id,w.workspace_id,w.project_id,w.name,w.current_version,w.created_by,
       w.created_at AS workflow_created_at,w.updated_at AS workflow_updated_at,v.*
       FROM workflows w JOIN workspace_members m ON m.workspace_id=w.workspace_id
       JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=w.current_version
       WHERE w.id=$1 AND m.user_id=$2`,
      [workflowId, userId],
    );
    return result.rows[0]
      ? {
          workflow: mapWorkflow(result.rows[0], "workflow_"),
          version: mapVersion(result.rows[0]),
          replayed: false,
        }
      : null;
  }
}
function mapWorkflow(row: Record<string, unknown>, timestampPrefix = "") {
  return {
    id: String(row.id ?? row.workflow_id),
    workspaceId: String(row.workspace_id),
    projectId: String(row.project_id),
    name: String(row.name),
    currentVersion: Number(row.current_version),
    createdBy: String(row.created_by),
    createdAt: iso(row[`${timestampPrefix}created_at`]),
    updatedAt: iso(row[`${timestampPrefix}updated_at`]),
  };
}
function mapVersion(row: Record<string, unknown>) {
  return {
    workflowId: String(row.workflow_id),
    version: Number(row.version),
    projectRevision: Number(row.project_revision),
    publicationId: String(row.publication_id),
    definition: row.definition as WorkflowVersionRecord["definition"],
    sourceMapping: row.source_mapping as WorkflowVersionRecord["sourceMapping"],
    warnings: row.warnings as WorkflowVersionRecord["warnings"],
    publishedBy: String(row.published_by),
    createdAt: iso(row.created_at),
  };
}
function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value);
}
