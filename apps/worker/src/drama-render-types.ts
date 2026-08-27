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
    timeline: unknown[];
    settings: Record<string, unknown>;
  };
  leaseUntil: string;
  updatedAt: string;
};
