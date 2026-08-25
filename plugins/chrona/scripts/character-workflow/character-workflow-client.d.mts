export type CharacterWorkflowClientName = "codex" | "claude";
export type CharacterStageCommand = "analyze-image" | "generate-tpose" | "generate-model" | "rig-check" | "rig" | "retarget";
export type ConfirmableCharacterStage = "tpose" | "model_generation" | "rigging";
export type CharacterImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface CodexCharacterAnalysis {
  subjectCount: number;
  isHumanBiped: boolean;
  fullBodyVisible: boolean;
  frontFacing: boolean;
  sourceQuality: "good" | "usable" | "poor";
  notes: string[];
}

export interface CodexTPoseQualityReport {
  singlePerson: boolean;
  fullBody: boolean;
  frontFacing: boolean;
  armsHorizontal: boolean;
  legsValid: boolean;
  noCrop: boolean;
  identityPreserved: boolean;
  whiteBackground: boolean;
  passed: boolean;
  score: number;
  issues: string[];
  source: "codex-host";
}

export interface MaterializedCharacterSource {
  workflowId: string;
  version: number;
  artifactId: string;
  mimeType: CharacterImageMimeType;
  localPath: string;
}

export interface CharacterWorkflowSummary {
  workflowId: string;
  displayName: string;
  version: number;
  status: string;
  stage: string;
  origin?: { client: CharacterWorkflowClientName; linkedAt: string };
  activeArtifactIds: Record<string, string>;
  selectedActionIds: string[];
  artifacts: Array<Record<string, unknown> & { directPreviewUrl?: string }>;
  actionTasks: Array<Record<string, unknown>>;
  actionCatalog: Array<Record<string, unknown>>;
  actionPreviewUrls: Array<{ actionId: string; artifactId: string; fileName?: string; previewUrl: string; downloadUrl?: string }>;
  deliveries: Array<{ artifactId: string; kind: string; actionId?: string; fileName?: string; sizeBytes?: number; previewUrl?: string; downloadUrl?: string }>;
  workbenchUrl: string;
  previewUrl?: string;
  fileName?: string;
  downloadUrl?: string;
}

export interface CharacterWorkflowClient {
  create(input: { displayName: string; clientRequestId: string; client: CharacterWorkflowClientName }): Promise<CharacterWorkflowSummary>;
  attachSource(input: { workflowId: string; expectedVersion: number; sourcePath: string; viewRole?: "front" | "side" | "back" | "detail" }): Promise<CharacterWorkflowSummary>;
  materializeSource(input: { workflowId: string }): Promise<MaterializedCharacterSource>;
  attachTPose(input: {
    workflowId: string;
    expectedVersion: number;
    sourcePath: string;
    analysis: CodexCharacterAnalysis;
    qualityReport: CodexTPoseQualityReport;
  }): Promise<CharacterWorkflowSummary>;
  get(input: { workflowId: string }): Promise<CharacterWorkflowSummary>;
  wait(input: { workflowId: string; afterVersion: number; timeoutSeconds?: number }): Promise<CharacterWorkflowSummary>;
  startStage(input: { workflowId: string; expectedVersion: number; command: CharacterStageCommand }): Promise<CharacterWorkflowSummary>;
  confirmOutput(input: { workflowId: string; expectedVersion: number; stage: ConfirmableCharacterStage; artifactId?: string; nextCommand?: CharacterStageCommand }): Promise<CharacterWorkflowSummary>;
  selectActions(input: { workflowId: string; expectedVersion: number; actionIds: string[] }): Promise<CharacterWorkflowSummary>;
  publish(input: { workflowId: string; confirmedByUser: true }): Promise<CharacterWorkflowSummary>;
}

export class CharacterWorkflowClientError extends Error {
  code: string;
  status?: number;
  recoverable: boolean;
  latest?: CharacterWorkflowSummary;
  details?: unknown;
}

export function createCharacterWorkflowClient(options?: Record<string, unknown>): CharacterWorkflowClient;
