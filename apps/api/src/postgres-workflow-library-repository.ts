import pg from "pg";
import { DomainError } from "./domain.js";
import type {
  WorkflowFolder,
  WorkflowLibraryMetadata,
  WorkflowLibraryRepository,
} from "./workflow-library-repository.js";

export class PostgresWorkflowLibraryRepository implements WorkflowLibraryRepository {
  private readonly pool: pg.Pool;
  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }
  async createFolder(folder: WorkflowFolder) {
    try {
      const result = await this.pool.query(
        `INSERT INTO workflow_folders(id,workspace_id,name,created_by,created_at,updated_at)
         SELECT $1,$2,$3,$4,$5,$6 WHERE EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=$2 AND user_id=$4 AND role IN ('owner','admin','editor')) RETURNING *`,
        [
          folder.id,
          folder.workspaceId,
          folder.name,
          folder.createdBy,
          folder.createdAt,
          folder.updatedAt,
        ],
      );
      if (!result.rows[0])
        throw new DomainError("WORKSPACE_NOT_FOUND", 404, "工作区不存在");
      return mapFolder(result.rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new DomainError("FOLDER_EXISTS", 409, "同名文件夹已存在");
      throw error;
    }
  }
  async listFolders(userId: string, workspaceId: string) {
    const result = await this.pool.query(
      `SELECT f.* FROM workflow_folders f JOIN workspace_members m ON m.workspace_id=f.workspace_id
       WHERE f.workspace_id=$1 AND m.user_id=$2 ORDER BY f.name`,
      [workspaceId, userId],
    );
    return result.rows.map(mapFolder);
  }
  async deleteFolder(userId: string, folderId: string) {
    const result = await this.pool.query(
      `DELETE FROM workflow_folders f USING workspace_members m WHERE f.id=$1 AND m.user_id=$2
       AND m.workspace_id=f.workspace_id AND m.role IN ('owner','admin','editor') RETURNING f.id`,
      [folderId, userId],
    );
    if (!result.rows[0])
      throw new DomainError("FOLDER_NOT_FOUND", 404, "文件夹不存在");
  }
  async listMetadata(userId: string, workspaceId: string) {
    const result = await this.pool.query(
      `SELECT e.*,w.workspace_id FROM workflow_library_entries e JOIN workflows w ON w.id=e.workflow_id
       JOIN workspace_members m ON m.workspace_id=w.workspace_id WHERE w.workspace_id=$1 AND m.user_id=$2`,
      [workspaceId, userId],
    );
    return result.rows.map(mapMetadata);
  }
  async upsertMetadata(userId: string, metadata: WorkflowLibraryMetadata) {
    const result = await this.pool.query(
      `INSERT INTO workflow_library_entries(workflow_id,folder_id,cover_asset_id,description,tags,is_template,updated_at)
       SELECT w.id,$3,$4,$5,$6::jsonb,$7,$8 FROM workflows w JOIN workspace_members m ON m.workspace_id=w.workspace_id
       WHERE w.id=$1 AND w.workspace_id=$2 AND m.user_id=$9 AND m.role IN ('owner','admin','editor')
       AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM workflow_folders f WHERE f.id=$3 AND f.workspace_id=w.workspace_id))
       AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM media_assets a WHERE a.id=$4 AND a.workspace_id=w.workspace_id))
       ON CONFLICT(workflow_id) DO UPDATE SET folder_id=EXCLUDED.folder_id,cover_asset_id=EXCLUDED.cover_asset_id,
       description=EXCLUDED.description,tags=EXCLUDED.tags,is_template=EXCLUDED.is_template,updated_at=EXCLUDED.updated_at RETURNING *`,
      [
        metadata.workflowId,
        metadata.workspaceId,
        metadata.folderId,
        metadata.coverAssetId,
        metadata.description,
        JSON.stringify(metadata.tags),
        metadata.isTemplate,
        metadata.updatedAt,
        userId,
      ],
    );
    if (!result.rows[0])
      throw new DomainError(
        "WORKFLOW_LIBRARY_REFERENCE_INVALID",
        404,
        "Workflow、文件夹或封面不存在",
      );
    return {
      ...mapMetadata(result.rows[0]),
      workspaceId: metadata.workspaceId,
    };
  }
}
function mapFolder(row: Record<string, unknown>): WorkflowFolder {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    createdBy: String(row.created_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function mapMetadata(row: Record<string, unknown>): WorkflowLibraryMetadata {
  return {
    workflowId: String(row.workflow_id),
    workspaceId: String(row.workspace_id || ""),
    folderId: row.folder_id ? String(row.folder_id) : null,
    coverAssetId: row.cover_asset_id ? String(row.cover_asset_id) : null,
    description: String(row.description || ""),
    tags: (row.tags || []) as string[],
    isTemplate: Boolean(row.is_template),
    updatedAt: iso(row.updated_at),
  };
}
function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value);
}
