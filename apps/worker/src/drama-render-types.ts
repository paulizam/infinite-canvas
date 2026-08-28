export type DramaRenderJob = {
  id: string;
  projectId: string;
  workspaceId: string;
  ownerId: string;
  kind: "ffmpeg" | "jianying";
  status: "running";
  progress: number;
  attempt: number;
  input: {
    assetIds: string[];
    materials?: Array<{
      assetId: string;
      kind: "image" | "video" | "audio";
      shotId: string | null;
      startMs: number;
      durationMs: number;
      sortOrder: number;
    }>;
    timeline: unknown[];
    settings: Record<string, unknown>;
  };
  leaseUntil: string;
  updatedAt: string;
};
