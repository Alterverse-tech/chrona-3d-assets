#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { CharacterWorkflowClientError, createCharacterWorkflowClient } from "./character-workflow-client.mjs";

const SERVER_NAME = "chrona-character-workflow";
const SERVER_VERSION = "0.1.7";
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

const workflowId = { type: "string", minLength: 3, maxLength: 160, pattern: "^[A-Za-z0-9_-]+$" };
const expectedVersion = { type: "integer", minimum: 1 };
const command = { type: "string", enum: ["analyze-image", "generate-tpose", "generate-model", "rig-check", "rig", "retarget"] };
const boundedNotes = {
  type: "array",
  items: { type: "string", maxLength: 300 },
  maxItems: 32
};
const analysis = {
  type: "object",
  properties: {
    subjectCount: { type: "integer", minimum: 0, maximum: 16 },
    isHumanBiped: { type: "boolean" },
    fullBodyVisible: { type: "boolean" },
    frontFacing: { type: "boolean" },
    sourceQuality: { type: "string", enum: ["good", "usable", "poor"] },
    notes: boundedNotes
  },
  required: ["subjectCount", "isHumanBiped", "fullBodyVisible", "frontFacing", "sourceQuality", "notes"],
  additionalProperties: false
};
const qualityReport = {
  type: "object",
  properties: {
    singlePerson: { type: "boolean" },
    fullBody: { type: "boolean" },
    frontFacing: { type: "boolean" },
    armsHorizontal: { type: "boolean" },
    legsValid: { type: "boolean" },
    noCrop: { type: "boolean" },
    identityPreserved: { type: "boolean" },
    whiteBackground: { type: "boolean" },
    passed: { type: "boolean" },
    score: { type: "number", minimum: 0, maximum: 100 },
    issues: boundedNotes,
    source: { type: "string", const: "codex-host" }
  },
  required: [
    "singlePerson",
    "fullBody",
    "frontFacing",
    "armsHorizontal",
    "legsValid",
    "noCrop",
    "identityPreserved",
    "whiteBackground",
    "passed",
    "issues",
    "source"
  ],
  additionalProperties: false
};

export const toolDefinitions = [
  {
    name: "create_character_workflow",
    description: "Create the one formal owner-scoped human-biped workflow after the user has explicitly selected a reference candidate. This is free and idempotent; it does not start generation.",
    inputSchema: {
      type: "object",
      properties: {
        displayName: { type: "string", minLength: 1, maxLength: 80 },
        clientRequestId: { ...workflowId, description: "Stable request ID reused for retries of this selected source." },
        client: { type: "string", enum: ["codex", "claude"] },
        provider: { type: "string", enum: ["tripo", "meshy"], default: "tripo" },
        meshyApiKey: { type: "string", minLength: 12, maxLength: 304, pattern: "^msy_[A-Za-z0-9_-]+$", description: "Required only when provider is meshy; never echo this secret." }
      },
      required: ["displayName", "clientRequestId", "client"],
      additionalProperties: false
    },
    annotations: { ...WRITE, idempotentHint: true }
  },
  {
    name: "attach_character_source",
    description: "Attach only the user-selected JPEG, PNG, or WebP as the workflow Uploaded source. Temporary chat candidates must not be uploaded.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId,
        expectedVersion,
        sourcePath: { type: "string", minLength: 1, maxLength: 4096 },
        viewRole: { type: "string", enum: ["front", "side", "back", "detail"], default: "front" }
      },
      required: ["workflowId", "expectedVersion", "sourcePath"],
      additionalProperties: false
    },
    annotations: WRITE
  },
  {
    name: "materialize_character_source",
    description: "Download the ready active primary input from its signed HTTPS preview into a bounded private local cache for native host image generation.",
    inputSchema: {
      type: "object",
      properties: { workflowId },
      required: ["workflowId"],
      additionalProperties: false
    },
    annotations: READ
  },
  {
    name: "attach_character_tpose",
    description: "Import one Codex-native T-Pose with a single quick identity/full-body/pose review under the user's automatic-pipeline choice. Fill the boolean report honestly, omit the optional score, and keep notes brief. No separate approval or scoring round; blocking failures stop continuation. Use the returned snapshot for the next step.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId,
        expectedVersion,
        sourcePath: { type: "string", minLength: 1, maxLength: 4096 },
        analysis,
        qualityReport
      },
      required: ["workflowId", "expectedVersion", "sourcePath", "analysis", "qualityReport"],
      additionalProperties: false
    },
    annotations: WRITE
  },
  {
    name: "get_character_workflow",
    description: "Refresh workflow state after user interaction, task resumption, a version conflict, or an expired delivery link. During continuous execution, reuse the snapshot/version returned by the previous tool instead of an extra GET.",
    inputSchema: {
      type: "object",
      properties: { workflowId },
      required: ["workflowId"],
      additionalProperties: false
    },
    annotations: READ
  },
  {
    name: "wait_character_workflow",
    description: "Wait while a stage is running, using afterVersion from the previous tool result. Returns the latest snapshot within 25 seconds; use it directly without surrounding GET calls or separate provider polls.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId,
        afterVersion: { type: "integer", minimum: 0 },
        timeoutSeconds: { type: "integer", minimum: 1, maximum: 25, default: 25 }
      },
      required: ["workflowId", "afterVersion"],
      additionalProperties: false
    },
    annotations: READ
  },
  {
    name: "start_character_stage",
    description: "Start an Asset Center character stage using the current workflow version. After the user selects a provider with the automatic-pipeline and credit disclosure, analysis, T-Pose, model generation, Rig Check, and rigging proceed without repeated chat approval, while retaining quality and backend confirmation prerequisites. Retarget requires the user's action choice. Stop before paid retries or provider changes. Generation may consume provider credits.",
    inputSchema: {
      type: "object",
      properties: { workflowId, expectedVersion, command },
      required: ["workflowId", "expectedVersion", "command"],
      additionalProperties: false
    },
    annotations: WRITE
  },
  {
    name: "confirm_character_output",
    description: "Select an optional generated candidate, confirm that existing stage, and optionally start a next command while carrying server versions safely. Under the user's disclosed automatic-pipeline choice, automatically confirm a usable T-Pose with nextCommand generate-model, then a validated static model with nextCommand rig-check, then the validated rig to reach action selection. These state-machine confirmations do not require repeated user acceptance prompts. Stop on blocking quality failures or conflicting workflow changes.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId,
        expectedVersion,
        stage: { type: "string", enum: ["tpose", "model_generation", "rigging"] },
        artifactId: { ...workflowId, description: "Omit when the intended output is already active; only supply to change the selected candidate." },
        nextCommand: command
      },
      required: ["workflowId", "expectedVersion", "stage"],
      additionalProperties: false
    },
    annotations: WRITE
  },
  {
    name: "select_character_actions",
    description: "Choose user-selected actions from the workflow catalog. The backend resolves the provider's action library; do not query Meshy separately. Use the returned version to start Retarget immediately without another GET or confirmation prompt.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId,
        expectedVersion,
        actionIds: { type: "array", items: { type: "string", minLength: 1, maxLength: 80 }, maxItems: 3, uniqueItems: true }
      },
      required: ["workflowId", "expectedVersion", "actionIds"],
      additionalProperties: false
    },
    annotations: WRITE
  },
  {
    name: "publish_character_workflow",
    description: "Publish a ready character workflow to Asset Center only after the user explicitly confirmed publishing in the current turn.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId,
        confirmedByUser: { type: "boolean", const: true }
      },
      required: ["workflowId", "confirmedByUser"],
      additionalProperties: false
    },
    annotations: WRITE
  }
];

export async function dispatchTool(name, args, client = createCharacterWorkflowClient()) {
  if (name === "create_character_workflow") return client.create(args);
  if (name === "attach_character_source") return client.attachSource(args);
  if (name === "materialize_character_source") return client.materializeSource(args);
  if (name === "attach_character_tpose") return client.attachTPose(args);
  if (name === "get_character_workflow") return client.get(args);
  if (name === "wait_character_workflow") return client.wait(args);
  if (name === "start_character_stage") return client.startStage(args);
  if (name === "confirm_character_output") return client.confirmOutput(args);
  if (name === "select_character_actions") return client.selectActions(args);
  if (name === "publish_character_workflow") return client.publish(args);
  throw new CharacterWorkflowClientError(`Unknown tool: ${name}`, { code: "unknown_tool" });
}

class StdioJsonRpcReader {
  constructor(onMessage) {
    this.buffer = Buffer.alloc(0);
    this.onMessage = onMessage;
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const parsed = this.readOne();
      if (!parsed) return;
      Promise.resolve(this.onMessage(parsed.message, parsed.framing)).catch((error) => {
        process.stderr.write(`[${SERVER_NAME}] ${safeMessage(error)}\n`);
      });
    }
  }

  readOne() {
    const start = this.buffer.toString("utf8", 0, Math.min(this.buffer.length, 32));
    return /^Content-Length:/i.test(start) ? this.readContentLength() : this.readLine();
  }

  readContentLength() {
    const separator = this.buffer.indexOf("\r\n\r\n");
    if (separator < 0) return null;
    const headers = this.buffer.subarray(0, separator).toString("utf8");
    const match = headers.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i);
    if (!match) throw new Error("Missing Content-Length header");
    const length = Number(match[1]);
    const bodyStart = separator + 4;
    if (this.buffer.length < bodyStart + length) return null;
    const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
    this.buffer = this.buffer.subarray(bodyStart + length);
    return { message: JSON.parse(body), framing: "content-length" };
  }

  readLine() {
    const newline = this.buffer.indexOf("\n");
    if (newline < 0) return null;
    const line = this.buffer.subarray(0, newline).toString("utf8").trim();
    this.buffer = this.buffer.subarray(newline + 1);
    if (!line) return this.readOne();
    return { message: JSON.parse(line), framing: "newline" };
  }
}

function writeMessage(message, framing) {
  const body = JSON.stringify(message);
  if (framing === "content-length") {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    return;
  }
  process.stdout.write(`${body}\n`);
}

async function handleMessage(message, framing) {
  if (!message || typeof message !== "object" || message.id === undefined) return;
  try {
    if (message.method === "initialize") {
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
        }
      }, framing);
      return;
    }
    if (message.method === "ping") {
      writeMessage({ jsonrpc: "2.0", id: message.id, result: {} }, framing);
      return;
    }
    if (message.method === "tools/list") {
      writeMessage({ jsonrpc: "2.0", id: message.id, result: { tools: toolDefinitions } }, framing);
      return;
    }
    if (message.method === "tools/call") {
      const summary = await dispatchTool(message.params?.name, message.params?.arguments ?? {});
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: resultText(summary) }],
          structuredContent: summary
        }
      }, framing);
      return;
    }
    writeMessage({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } }, framing);
  } catch (error) {
    const structured = error instanceof CharacterWorkflowClientError ? {
      code: error.code,
      message: error.message,
      recoverable: error.recoverable,
      ...(error.latest ? { latest: error.latest } : {})
    } : { code: "internal_error", message: safeMessage(error), recoverable: false };
    writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        isError: true,
        content: [{ type: "text", text: structured.message }],
        structuredContent: { error: structured }
      }
    }, framing);
  }
}

export function resultText(result) {
  if (result && typeof result === "object" && typeof result.localPath === "string") {
    return [
      `Active source ready: ${result.artifactId} · ${result.mimeType} · v${result.version}`,
      `Workflow: ${result.workflowId}`
    ].join("\n");
  }
  const lines = [
    `${result.displayName}: ${result.stage} · ${result.status} · v${result.version}`,
    `Workflow: ${result.workflowId}`
  ];
  if (typeof result.previewUrl === "string") lines.push(`Preview: ${result.previewUrl}`);
  if (Array.isArray(result.deliveries) && result.deliveries.length) {
    lines.push("Artifacts:");
    for (const delivery of result.deliveries) {
      lines.push(`- File: ${delivery.fileName ?? delivery.artifactId}`);
      if (delivery.previewUrl) lines.push(`  Preview: ${delivery.previewUrl}`);
      lines.push(`  Download: ${delivery.downloadUrl ?? "unavailable"}`);
      lines.push(`  Workbench: ${result.workbenchUrl}`);
    }
  }
  if (!Array.isArray(result.deliveries) || !result.deliveries.length) lines.push(`Workbench: ${result.workbenchUrl}`);
  return lines.join("\n");
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const reader = new StdioJsonRpcReader(handleMessage);
  process.stdin.on("data", (chunk) => reader.push(chunk));
  process.stdin.resume();
}
