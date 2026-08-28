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
import { AdminMfaService } from "./admin-mfa-service.js";
import { PostgresAdminMfaRepository } from "./postgres-admin-mfa-repository.js";
import { DataGovernanceService } from "./data-governance-service.js";
import { PostgresDataGovernanceRepository } from "./postgres-data-governance-repository.js";
import {
  IdentityService,
  ProjectService,
  WorkspaceService,
} from "./services.js";

const databaseUrl = required("DATABASE_URL");
const sessionTtlSeconds = Number(required("SESSION_TTL_SECONDS"));
const repository = new PostgresPlatformRepository(databaseUrl);
const identity = new IdentityService(
  repository,
  sessionTtlSeconds * 1000,
  strongToken("INSTALL_TOKEN"),
);
const projects = new ProjectService(repository);
const jobRepository = new PostgresGenerationJobRepository(databaseUrl);
const workerToken = tokenRing("WORKER_TOKEN");
const maintenanceToken = tokenRing("MAINTENANCE_TOKEN");
if (workerToken.some((token) => maintenanceToken.includes(token)))
  throw new Error("Worker and Maintenance token rings must be distinct");
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
const blobStore = createBlobStores();
const assets = new AssetService(
  repository,
  blobStore,
  Number(required("MAX_UPLOAD_BYTES")),
);
const generationJobs = new GenerationJobService(repository, jobRepository);
const drama = new DramaService(
  repository,
  new PostgresDramaRepository(databaseUrl),
  generationJobs,
);
const dramaProduction = new DramaProductionService(
  repository,
  drama,
  new PostgresDramaProductionRepository(databaseUrl),
  generationJobs,
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
  jobs: generationJobs,
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
  adminMfa: new AdminMfaService(
    new PostgresAdminMfaRepository(databaseUrl),
    new SecretCipher(required("MFA_SECRET_KEY"), "MFA_SECRET_KEY"),
    required("MFA_RECOVERY_PEPPER"),
  ),
  governance: new DataGovernanceService(
    new PostgresDataGovernanceRepository(databaseUrl),
    blobStore,
    identity,
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
function tokenRing(name: "WORKER_TOKEN" | "MAINTENANCE_TOKEN") {
  const current = strongToken(name),
    previous = process.env[`${name}_PREVIOUS`]?.trim();
  if (!previous) return [current] as const;
  if (previous.length < 32)
    throw new Error(`${name}_PREVIOUS must contain at least 32 characters`);
  if (previous === current)
    throw new Error(`${name}_PREVIOUS must differ from ${name}`);
  const raw = required(`${name}_PREVIOUS_EXPIRES_AT`),
    expires = Date.parse(raw);
  if (!Number.isFinite(expires) || expires <= Date.now())
    throw new Error(
      `${name}_PREVIOUS_EXPIRES_AT must be a future ISO-8601 timestamp`,
    );
  return [current, previous] as const;
}

function positiveInteger(name: string) {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

function createBlobStores() {
  const driver = required("BLOB_STORAGE_DRIVER");
  if (driver !== "local" && driver !== "s3")
    throw new Error(`Unsupported BLOB_STORAGE_DRIVER: ${driver}`);
  const stores: Record<string, LocalAssetBlobStore | S3AssetBlobStore> = {};
  const localRoot = process.env.ASSET_LOCAL_ROOT?.trim();
  if (localRoot) stores.local = new LocalAssetBlobStore(localRoot);
  const s3 = [
    "S3_BUCKET",
    "S3_REGION",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ].map((name) => process.env[name]?.trim());
  if (s3.every(Boolean))
    stores.s3 = new S3AssetBlobStore(s3[0]!, {
      region: s3[1]!,
      endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
      accessKeyId: s3[2]!,
      secretAccessKey: s3[3]!,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    });
  if (!stores[driver])
    throw new Error(
      `${driver === "local" ? "ASSET_LOCAL_ROOT" : "S3 configuration"} is required for BLOB_STORAGE_DRIVER=${driver}`,
    );
  return { currentProvider: driver, stores };
}
