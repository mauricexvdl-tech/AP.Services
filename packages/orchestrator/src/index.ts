/**
 * @module @aporia/orchestrator
 * ResurrectionOrchestrator – E2E autonomous bot resurrection pipeline
 */

export {
  ResurrectionOrchestrator,
  type OrchestratorConfig,
  type ResurrectionResult,
  type ResurrectionPhase,
} from "./orchestrator";

export {
  type DeploymentBackend,
  type DeployRequest,
  type DeployResponse,
  DockerBackend,
} from "./backends";

export { AkashBackend, type AkashConfig } from "./akash-backend";

export { OrchestratorService, type ServiceConfig } from "./service";
