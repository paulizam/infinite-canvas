import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { PostgresPlatformRepository } from "./postgres-repository.js";
import { CollaborationHub } from "./collaboration.js";
import { AssetService } from "./asset-service.js";
import { LocalAssetBlobStore, S3AssetBlobStore } from "./blob-store.js";
import { PostgresGenerationJobRepository } from "./postgres-generation-job-repository.js";
import { PostgresGenerationEventRepository } from "./postgres-generation-event-repository.js";
import { GenerationJobService } from "./generation-job-service.js";
import { PostgresModelGatewayRepository } from "./postgres-model-gateway-repository.js";
import { SecretCipher } from "./secret-cipher.js";
import { PostgresWorkflowRepository } from "./postgres-workflow-repository.js";
import { WorkflowPublicationService } from "./workflow-service.js";
import { WorkflowExecutionService } from "./workflow-execution-service.js";
import { PostgresWorkflowExecutionRepository } from "./postgres-workflow-execution-repository.js";
import { WorkflowExecutionWorkerService } from "./workflow-execution-worker-service.js";
import { PostgresWorkflowTriggerRepository } from "./postgres-workflow-trigger-repository.js";
import { WorkflowTriggerService } from "./workflow-trigger-service.js";
import { PostgresWorkflowLibraryRepository } from "./postgres-workflow-library-repository.js";
import { WorkflowLibraryService } from "./workflow-library-service.js";
import { PostgresWorkflowPublicApiRepository } from "./postgres-workflow-public-api-repository.js";
import { WorkflowPublicApiService } from "./workflow-public-api-service.js";
import { PostgresAgentRunRepository } from "./postgres-agent-run-repository.js";
import { AgentRunService } from "./agent-run-service.js";
import { PostgresDramaRepository } from "./postgres-drama-repository.js";
import { DramaService } from "./drama-service.js";
import { DramaProductionService } from "./drama-production-service.js";
import { PostgresDramaProductionRepository } from "./postgres-drama-production-repository.js";
import { DramaRenderService } from "./drama-render-service.js";
import { PostgresDramaRenderRepository } from "./postgres-drama-render-repository.js";
import { DramaInteropService } from "./drama-interop-service.js";
import { CommunityService } from "./community-service.js";
import { PostgresCommunityRepository } from "./postgres-community-repository.js";
import { CommunitySocialService } from "./community-social-service.js";
import { PostgresCommunitySocialRepository } from "./postgres-community-social-repository.js";
import { CommerceService } from "./commerce-service.js";
import { PostgresCommerceRepository } from "./postgres-commerce-repository.js";
import { HttpPaymentAdapter, PaymentService } from "./payment-service.js";
import { PostgresPaymentRepository } from "./postgres-payment-repository.js";
import { AdminService } from "./admin-service.js";
import { PostgresAdminRepository } from "./postgres-admin-repository.js";
import {
  IdentityService,
  ProjectService,
  WorkspaceService,
} from "./services.js";

const databaseUrl = required("DATABASE_URL");
const sessionTtlSeconds = Number(required("SESSION_TTL_SECONDS"));
const repository = new PostgresPlatformRepository(databaseUrl);
const identity = new IdentityService(repository, sessionTtlSeconds * 1000);
const projects = new ProjectService(repository);
const jobRepository = new PostgresGenerationJobRepository(databaseUrl);
const workerToken = strongToken("WORKER_TOKEN");
const maintenanceToken = strongToken("MAINTENANCE_TOKEN");
if (workerToken === maintenanceToken)
  throw new Error("WORKER_TOKEN and MAINTENANCE_TOKEN must be distinct");
const modelSecretCipher = new SecretCipher(required("MODEL_SECRET_KEY"));
const modelGateway = new PostgresModelGatewayRepository(
  databaseUrl,
  modelSecretCipher,
);
const workflowRepository = new PostgresWorkflowRepository(databaseUrl);
const workflowExecutionRepository = new PostgresWorkflowExecutionRepository(
  databaseUrl,
);
const workflowExecutionService = new WorkflowExecutionService(
  repository,
  workflowRepository,
  workflowExecutionRepository,
);
const workflowTriggerRepository = new PostgresWorkflowTriggerRepository(
  databaseUrl,
);
const workflowLibraryRepository = new PostgresWorkflowLibraryRepository(
  databaseUrl,
);
const workflowPublicApiRepository = new PostgresWorkflowPublicApiRepository(
  databaseUrl,
);
const agentRunRepository = new PostgresAgentRunRepository(databaseUrl);
const assets = new AssetService(
  repository,
  createBlobStore(),
  Number(required("MAX_UPLOAD_BYTES")),
);
const drama = new DramaService(
  repository,
  new PostgresDramaRepository(databaseUrl),
);
const dramaProduction = new DramaProductionService(
  repository,
  drama,
  new PostgresDramaProductionRepository(databaseUrl),
  new GenerationJobService(repository, jobRepository),
);
const dramaRender = new DramaRenderService(
  repository,
  drama,
  dramaProduction,
  new PostgresDramaRenderRepository(databaseUrl),
  assets,
);
const collaboration = new CollaborationHub(
  identity,
  projects,
  new Set(
    required("COLLABORATION_ORIGINS")
      .split(",")
      .map((origin) => new URL(origin.trim()).origin),
  ),
);
const app = createApp({
  identity,
  workspaces: new WorkspaceService(repository),
  projects,
  assets,
  jobs: new GenerationJobService(repository, jobRepository),
  jobRepository,
  eventRepository: new PostgresGenerationEventRepository(databaseUrl),
  workerToken,
  workerStaleMs: positiveInteger("WORKER_STALE_MS"),
  modelGateway,
  workflows: new WorkflowPublicationService(repository, workflowRepository),
  workflowExecutions: workflowExecutionService,
  workflowWorker: new WorkflowExecutionWorkerService(
    workflowExecutionRepository,
  ),
  workflowTriggers: new WorkflowTriggerService(
    repository,
    workflowRepository,
    workflowExecutionService,
    workflowTriggerRepository,
  ),
  workflowLibrary: new WorkflowLibraryService(
    repository,
    workflowRepository,
    workflowLibraryRepository,
  ),
  workflowPublicApi: new WorkflowPublicApiService(
    repository,
    workflowRepository,
    workflowExecutionService,
    workflowPublicApiRepository,
  ),
  agentRuns: new AgentRunService(repository, agentRunRepository),
  drama,
  dramaProduction,
  dramaRender,
  dramaInterop: new DramaInteropService(
    repository,
    projects,
    drama,
    dramaProduction,
    dramaRender,
  ),
  community: new CommunityService(
    repository,
    projects,
    new PostgresCommunityRepository(databaseUrl),
  ),
  communitySocial: new CommunitySocialService(
    new PostgresCommunitySocialRepository(databaseUrl),
  ),
  commerce: new CommerceService(
    new PostgresCommerceRepository(databaseUrl),
    required("BILLING_CODE_SECRET"),
    {
      inviter: positiveInteger("INVITE_INVITER_REWARD_UNITS"),
      invitee: positiveInteger("INVITE_INVITEE_REWARD_UNITS"),
    },
  ),
  payments: new PaymentService(
    new PostgresPaymentRepository(databaseUrl),
    new HttpPaymentAdapter(
      required("PAYMENT_PROVIDER"),
      required("PAYMENT_API_BASE_URL"),
      required("PAYMENT_API_TOKEN"),
    ),
    required("PAYMENT_WEBHOOK_SECRET"),
    positiveInteger("PAYMENT_WEBHOOK_TOLERANCE_SECONDS"),
  ),
  admin: new AdminService(
    new PostgresAdminRepository(databaseUrl),
    modelSecretCipher,
  ),
  maintenanceToken,
  collaboration,
  secureCookies: process.env.NODE_ENV === "production",
});
const port = Number(process.env.PORT || "3001");
const server = serve({ fetch: app.fetch, port }, (info) =>
  console.log(`API listening on http://localhost:${info.port}`),
);
collaboration.attach(server as import("node:http").Server);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function strongToken(name: string) {
  const token = required(name);
  if (token.length < 32)
    throw new Error(`${name} must contain at least 32 characters`);
  return token;
}

function positiveInteger(name: string) {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

function createBlobStore() {
  const driver = required("BLOB_STORAGE_DRIVER");
  if (driver === "local")
    return new LocalAssetBlobStore(required("ASSET_LOCAL_ROOT"));
  if (driver === "s3")
    return new S3AssetBlobStore(required("S3_BUCKET"), {
      region: required("S3_REGION"),
      endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    });
  throw new Error(`Unsupported BLOB_STORAGE_DRIVER: ${driver}`);
}
