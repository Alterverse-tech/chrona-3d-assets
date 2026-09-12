import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { ensureOAuthAccessToken } from "./oauth-login.mjs";

const DEFAULT_API_BASE_URL = "https://studio.13-216-49-19.sslip.io/codex/v1";
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const STAGE_COMMANDS = new Set(["analyze-image", "generate-tpose", "generate-model", "rig-check", "rig", "retarget"]);

export class CharacterWorkflowClientError extends Error {
  constructor(message, { code = "request_failed", status, recoverable = false, latest, details } = {}) {
    super(message);
    this.name = "CharacterWorkflowClientError";
    this.code = code;
    this.status = status;
    this.recoverable = recoverable;
    this.latest = latest;
    this.details = details;
  }
}

export function createCharacterWorkflowClient({
  apiBaseUrl = process.env.ASSET_CENTER_CODEX_API_BASE_URL || DEFAULT_API_BASE_URL,
  accessTokenProvider = ensureOAuthAccessToken,
  fetchImpl = fetch,
  sleepImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = Date.now,
  cacheRoot = path.join(os.tmpdir(), "chrona-character-workflow")
} = {}) {
  const baseUrl = apiBaseUrl.replace(/\/+$/, "");
  const origin = new URL(baseUrl).origin;
  const resolvedCacheRoot = path.resolve(cacheRoot);

  async function accessToken(forceRefresh = false) {
    const serviceToken = process.env.ASSET_CENTER_SERVICE_TOKEN?.trim();
    if (serviceToken) return serviceToken;
    return accessTokenProvider(origin, { forceRefresh });
  }

  async function requestJson(route, init = {}, retryAuth = true) {
    const token = await accessToken(false);
    const response = await fetchImpl(`${baseUrl}${route}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.headers ?? {})
      }
    });
    if (response.status === 401 && retryAuth && !process.env.ASSET_CENTER_SERVICE_TOKEN) {
      await accessTokenProvider(origin, { forceRefresh: true });
      return requestJson(route, init, false);
    }
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
    if (!response.ok) {
      const message = payload?.error?.message || payload?.error || `Asset Center request failed (HTTP ${response.status})`;
      throw new CharacterWorkflowClientError(String(message), {
        status: response.status,
        code: payload?.error?.code || "request_failed",
        details: payload
      });
    }
    return payload;
  }

  async function getRaw(workflowId) {
    return requestJson(`/character-workflows/${encodeURIComponent(workflowId)}`);
  }

  async function get(input) {
    return normalizeSnapshot(await getRaw(requireId(input?.workflowId, "workflowId")), baseUrl);
  }

  async function mutate(workflowId, route, body) {
    try {
      return await requestJson(`/character-workflows/${encodeURIComponent(workflowId)}${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch (error) {
      if (error instanceof CharacterWorkflowClientError && error.status === 409) {
        const latest = await get({ workflowId });
        throw new CharacterWorkflowClientError(error.message, {
          code: "stale_version",
          status: 409,
          recoverable: true,
          latest,
          details: error.details
        });
      }
      throw error;
    }
  }

  async function create(input) {
    const displayName = requireText(input?.displayName, "displayName", 80);
    const clientRequestId = requireId(input?.clientRequestId, "clientRequestId");
    const client = input?.client;
    if (client !== "codex" && client !== "claude") {
      throw new CharacterWorkflowClientError("client must be codex or claude", { code: "invalid_input" });
    }
    const provider = input?.provider ?? "tripo";
    if (provider !== "tripo" && provider !== "meshy") {
      throw new CharacterWorkflowClientError("provider must be tripo or meshy", { code: "invalid_input" });
    }
    const meshyApiKey = provider === "meshy" ? requireMeshyApiKey(input?.meshyApiKey) : undefined;
    const created = await requestJson("/character-workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName, clientRequestId, origin: { client }, provider, ...(meshyApiKey ? { meshyApiKey } : {}) })
    });
    return get({ workflowId: created.workflow?.id });
  }

  async function attachSource(input) {
    const workflowId = requireId(input?.workflowId, "workflowId");
    const expectedVersion = requireVersion(input?.expectedVersion);
    const sourcePath = requireText(input?.sourcePath, "sourcePath", 4096);
    const { bytes, mimeType } = await readLocalImage(sourcePath);
    const viewRole = input?.viewRole ?? "front";
    if (!["front", "side", "back", "detail"].includes(viewRole)) {
      throw new CharacterWorkflowClientError("viewRole is invalid", { code: "invalid_input" });
    }
    try {
      await requestJson(`/character-workflows/${encodeURIComponent(workflowId)}/uploads/direct`, {
        method: "POST",
        headers: {
          "content-type": mimeType,
          "x-character-workflow-version": String(expectedVersion),
          "x-character-view-role": viewRole
        },
        body: bytes
      });
    } catch (error) {
      if (error instanceof CharacterWorkflowClientError && error.status === 409) {
        const latest = await get({ workflowId });
        throw new CharacterWorkflowClientError(error.message, {
          code: "stale_version",
          status: 409,
          recoverable: true,
          latest,
          details: error.details
        });
      }
      throw error;
    }
    return get({ workflowId });
  }

  async function materializeSource(input) {
    const workflowId = requireId(input?.workflowId, "workflowId");
    let snapshot = await get({ workflowId });
    let source = activePrimaryInput(snapshot);
    let response = await fetchSignedPreview(source);

    if ([401, 403, 404, 410].includes(response.status)) {
      snapshot = await get({ workflowId });
      source = activePrimaryInput(snapshot);
      response = await fetchSignedPreview(source);
    }
    if (response.status !== 200) {
      throw new CharacterWorkflowClientError(`source preview download failed (HTTP ${response.status})`, {
        code: "invalid_source",
        status: response.status
      });
    }

    const responseMimeType = normalizedContentType(response.headers.get("content-type"));
    if (!isImageMimeType(responseMimeType) || responseMimeType !== source.mimeType) {
      throw new CharacterWorkflowClientError("source preview returned an unexpected content type", { code: "invalid_source" });
    }
    const bytes = await readBoundedResponse(response);
    validateImageBytes(bytes, responseMimeType);

    const workflowDirectory = path.join(resolvedCacheRoot, workflowId);
    await fs.mkdir(workflowDirectory, { recursive: true, mode: 0o700 });
    const destination = path.join(workflowDirectory, `${source.id}.${imageExtension(responseMimeType)}`);
    const temporary = path.join(workflowDirectory, `.${source.id}.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      await fs.rename(temporary, destination);
    } finally {
      await fs.rm(temporary, { force: true });
    }

    return {
      workflowId: snapshot.workflowId,
      version: snapshot.version,
      artifactId: source.id,
      mimeType: responseMimeType,
      localPath: destination
    };
  }

  async function attachTPose(input) {
    const workflowId = requireId(input?.workflowId, "workflowId");
    const expectedVersion = requireVersion(input?.expectedVersion);
    const sourcePath = requireText(input?.sourcePath, "sourcePath", 4096);
    const { bytes, mimeType } = await readLocalImage(sourcePath);
    const form = new FormData();
    form.append("expectedVersion", String(expectedVersion));
    form.append("analysis", jsonObjectField(input?.analysis, "analysis"));
    form.append("qualityReport", jsonObjectField(input?.qualityReport, "qualityReport"));
    form.append("file", new Blob([bytes], { type: mimeType }), path.basename(sourcePath));

    try {
      await requestJson(`/character-workflows/${encodeURIComponent(workflowId)}/tposes/direct`, {
        method: "POST",
        body: form
      });
    } catch (error) {
      if (error instanceof CharacterWorkflowClientError && error.status === 409) {
        const latest = await get({ workflowId });
        throw new CharacterWorkflowClientError(error.message, {
          code: "stale_version",
          status: 409,
          recoverable: true,
          latest,
          details: error.details
        });
      }
      throw error;
    }
    return get({ workflowId });
  }

  async function wait(input) {
    const workflowId = requireId(input?.workflowId, "workflowId");
    const afterVersion = Number(input?.afterVersion);
    if (!Number.isSafeInteger(afterVersion) || afterVersion < 0) {
      throw new CharacterWorkflowClientError("afterVersion must be a non-negative integer", { code: "invalid_input" });
    }
    const timeoutSeconds = Math.min(25, Math.max(1, Number(input?.timeoutSeconds) || 25));
    const deadline = now() + timeoutSeconds * 1000;
    let snapshot = await get({ workflowId });
    while (snapshot.version <= afterVersion && snapshot.status === "running" && now() < deadline) {
      await sleepImpl(1000);
      snapshot = await get({ workflowId });
    }
    return snapshot;
  }

  async function startStage(input) {
    const workflowId = requireId(input?.workflowId, "workflowId");
    const expectedVersion = requireVersion(input?.expectedVersion);
    const command = input?.command;
    if (!STAGE_COMMANDS.has(command)) {
      throw new CharacterWorkflowClientError("command is not a supported character stage", { code: "invalid_input" });
    }
    await mutate(workflowId, `/${command}`, { expectedVersion });
    return get({ workflowId });
  }

  async function confirmOutput(input) {
    const workflowId = requireId(input?.workflowId, "workflowId");
    let version = requireVersion(input?.expectedVersion);
    const stage = input?.stage;
    if (!["tpose", "model_generation", "rigging"].includes(stage)) {
      throw new CharacterWorkflowClientError("stage is not confirmable", { code: "invalid_input" });
    }
    if (input?.artifactId) {
      const selected = await mutate(workflowId, "/select-artifact", {
        artifactId: requireId(input.artifactId, "artifactId"),
        expectedVersion: version
      });
      version = requireVersion(selected.workflow?.version);
    }
    const confirmed = await mutate(workflowId, "/confirm", { stage, expectedVersion: version });
    version = requireVersion(confirmed.workflow?.version);
    if (input?.nextCommand !== undefined) {
      if (!STAGE_COMMANDS.has(input.nextCommand)) {
        throw new CharacterWorkflowClientError("nextCommand is not supported", { code: "invalid_input" });
      }
      await mutate(workflowId, `/${input.nextCommand}`, { expectedVersion: version });
    }
    return get({ workflowId });
  }

  async function selectActions(input) {
    const workflowId = requireId(input?.workflowId, "workflowId");
    const expectedVersion = requireVersion(input?.expectedVersion);
    if (!Array.isArray(input?.actionIds) || input.actionIds.some((value) => typeof value !== "string")) {
      throw new CharacterWorkflowClientError("actionIds must be a string array", { code: "invalid_input" });
    }
    await mutate(workflowId, "/actions", { actionIds: input.actionIds, expectedVersion });
    return get({ workflowId });
  }

  async function publish(input) {
    const workflowId = requireId(input?.workflowId, "workflowId");
    if (input?.confirmedByUser !== true) {
      throw new CharacterWorkflowClientError("Publishing requires immediate explicit user confirmation", { code: "confirmation_required" });
    }
    const current = await get({ workflowId });
    if (current.status !== "ready_to_publish") {
      throw new CharacterWorkflowClientError("Workflow is not ready to publish", { code: "not_ready", latest: current });
    }
    await mutate(workflowId, "/publish", { confirmedByUser: true });
    return get({ workflowId });
  }

  return {
    create,
    attachSource,
    materializeSource,
    attachTPose,
    get,
    wait,
    startStage,
    confirmOutput,
    selectActions,
    publish
  };

  function activePrimaryInput(snapshot) {
    const artifactId = snapshot.activeArtifactIds?.primaryInput;
    const artifact = snapshot.artifacts.find((candidate) => candidate.id === artifactId);
    if (!artifact || artifact.kind !== "input_image" || artifact.status !== "ready") {
      throw new CharacterWorkflowClientError("workflow has no ready active primary input", { code: "invalid_source" });
    }
    if (!isImageMimeType(artifact.mimeType)) {
      throw new CharacterWorkflowClientError("active primary input has an unsupported image type", { code: "invalid_source" });
    }
    if (Number.isFinite(artifact.sizeBytes) && artifact.sizeBytes > MAX_SOURCE_BYTES) {
      throw new CharacterWorkflowClientError("active primary input exceeds 10 MB", { code: "invalid_source" });
    }
    let previewUrl;
    try {
      previewUrl = new URL(artifact.previewUrl);
    } catch {
      throw new CharacterWorkflowClientError("active primary input has no valid preview URL", { code: "invalid_source" });
    }
    if (previewUrl.protocol !== "https:") {
      throw new CharacterWorkflowClientError("active primary input preview must use HTTPS", { code: "invalid_source" });
    }
    return { ...artifact, previewUrl: previewUrl.toString() };
  }

  async function fetchSignedPreview(source) {
    if (Number.isFinite(source.sizeBytes) && source.sizeBytes > MAX_SOURCE_BYTES) {
      throw new CharacterWorkflowClientError("active primary input exceeds 10 MB", { code: "invalid_source" });
    }
    return fetchImpl(source.previewUrl, { method: "GET" });
  }
}

function normalizeSnapshot(payload, apiBaseUrl) {
  const workflow = payload?.workflow;
  if (!workflow || typeof workflow.id !== "string") {
    throw new CharacterWorkflowClientError("Asset Center returned an invalid workflow snapshot", { code: "invalid_response" });
  }
  const workbenchUrl = new URL(`/asset-center/characters/${encodeURIComponent(workflow.id)}`, new URL(apiBaseUrl).origin).toString();
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts.map((artifact) => ({
    id: artifact.id,
    kind: artifact.kind,
    version: artifact.version,
    status: artifact.status,
    sourceArtifactIds: artifact.sourceArtifactIds ?? [],
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    fileName: artifact.fileName,
    previewUrl: artifact.preview?.url,
    downloadUrl: artifact.download?.url,
    directPreviewUrl: artifactDirectPreviewUrl(workbenchUrl, artifact.id, artifact.fileName),
    metadata: artifact.metadata,
    provider: artifact.provider,
    providerTaskId: artifact.providerTaskId
  })) : [];
  const actionPreviewUrls = readyActionPreviewUrls(artifacts, payload.actionTasks, workflow.selectedActionIds);
  const preferredPreview = preferredReadyGlb(artifacts, workflow, actionPreviewUrls);
  const deliveries = currentGlbDeliveries(artifacts, workflow, actionPreviewUrls);
  return {
    workflowId: workflow.id,
    displayName: workflow.displayName,
    version: workflow.version,
    status: workflow.status,
    stage: workflow.stage,
    provider: workflow.provider ?? "tripo",
    ...(workflow.origin ? { origin: workflow.origin } : {}),
    activeArtifactIds: workflow.activeArtifactIds ?? {},
    selectedActionIds: workflow.selectedActionIds ?? [],
    artifacts,
    actionTasks: Array.isArray(payload.actionTasks) ? payload.actionTasks : [],
    actionCatalog: Array.isArray(payload.actionCatalog) ? payload.actionCatalog : [],
    actionPreviewUrls,
    deliveries,
    workbenchUrl,
    ...(preferredPreview ? {
      previewUrl: preferredPreview.directPreviewUrl,
      fileName: preferredPreview.fileName,
      downloadUrl: preferredPreview.downloadUrl
    } : {})
  };
}

function artifactDirectPreviewUrl(workbenchUrl, artifactId, fileName) {
  if (typeof artifactId !== "string" || !/^[A-Za-z0-9_-]{3,160}$/.test(artifactId)) return undefined;
  const url = new URL(`/asset-center/preview/${encodeURIComponent(artifactId)}`, workbenchUrl);
  if (typeof fileName === "string" && fileName.trim()) url.searchParams.set("file", fileName.trim());
  url.searchParams.set("role", "creator");
  return url.toString();
}

function readyActionPreviewUrls(artifacts, actionTasks, selectedActionIds) {
  const readyActions = artifacts.filter((artifact) => artifact.kind === "retargeted_animation_glb" && artifact.status === "ready" && artifact.directPreviewUrl);
  const tasks = Array.isArray(actionTasks) ? actionTasks : [];
  const selected = Array.isArray(selectedActionIds) ? selectedActionIds : [];
  const ordered = selected.map((actionId) => {
    const task = tasks.find((candidate) => candidate.actionId === actionId && candidate.status === "success");
    return readyActions.find((artifact) => artifact.id === task?.artifactId)
      ?? [...readyActions].reverse().find((artifact) => artifact.metadata?.actionId === actionId);
  }).filter(Boolean);
  const remaining = readyActions.filter((artifact) => !ordered.some((candidate) => candidate.id === artifact.id));
  return [...ordered, ...remaining].map((artifact) => ({
    actionId: String(artifact.metadata?.actionId ?? artifact.id),
    artifactId: artifact.id,
    fileName: artifact.fileName,
    previewUrl: artifact.directPreviewUrl,
    downloadUrl: artifact.downloadUrl
  }));
}

function currentGlbDeliveries(artifacts, workflow, actionPreviewUrls) {
  const artifactIds = [
    workflow.activeArtifactIds?.baseModel,
    workflow.activeArtifactIds?.riggedModel,
    ...actionPreviewUrls.map((item) => item.artifactId)
  ].filter(Boolean);
  const seen = new Set();
  return artifactIds.flatMap((artifactId) => {
    if (seen.has(artifactId)) return [];
    seen.add(artifactId);
    const artifact = artifacts.find((candidate) => candidate.id === artifactId && candidate.status === "ready" && candidate.mimeType === "model/gltf-binary");
    if (!artifact) return [];
    return [{
      artifactId: artifact.id,
      kind: artifact.kind,
      ...(artifact.metadata?.actionId ? { actionId: String(artifact.metadata.actionId) } : {}),
      fileName: artifact.fileName,
      sizeBytes: artifact.sizeBytes,
      previewUrl: artifact.directPreviewUrl,
      downloadUrl: artifact.downloadUrl
    }];
  });
}

function preferredReadyGlb(artifacts, workflow, actionPreviewUrls) {
  const isReadyGlb = (artifact) => artifact?.status === "ready" && artifact.mimeType === "model/gltf-binary";
  if ((workflow.status === "ready_to_publish" || workflow.status === "published") && actionPreviewUrls[0]) {
    const action = artifacts.find((artifact) => artifact.id === actionPreviewUrls[0].artifactId);
    if (isReadyGlb(action)) return action;
  }
  for (const artifactId of [workflow.activeArtifactIds?.riggedModel, workflow.activeArtifactIds?.baseModel]) {
    const artifact = artifacts.find((candidate) => candidate.id === artifactId);
    if (isReadyGlb(artifact)) return artifact;
  }
  return [...artifacts].reverse().find(isReadyGlb);
}

function requireText(value, label, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength) {
    throw new CharacterWorkflowClientError(`${label} is required`, { code: "invalid_input" });
  }
  return text;
}

function requireMeshyApiKey(value) {
  if (typeof value !== "string" || !/^msy_[A-Za-z0-9_-]{8,300}$/.test(value.trim())) {
    throw new CharacterWorkflowClientError("meshyApiKey is required and must be a valid Meshy API key", { code: "invalid_input" });
  }
  return value.trim();
}

function requireId(value, label) {
  const id = requireText(value, label, 160);
  if (!/^[A-Za-z0-9_-]{3,160}$/.test(id)) {
    throw new CharacterWorkflowClientError(`${label} is invalid`, { code: "invalid_input" });
  }
  return id;
}

function requireVersion(value) {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new CharacterWorkflowClientError("expectedVersion must be a positive integer", { code: "invalid_input" });
  }
  return version;
}

function imageMimeType(sourcePath) {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  throw new CharacterWorkflowClientError("sourcePath must be a JPEG, PNG, or WebP image", { code: "invalid_source" });
}

async function readLocalImage(sourcePath) {
  const mimeType = imageMimeType(sourcePath);
  const bytes = await fs.readFile(sourcePath);
  validateImageBytes(bytes, mimeType);
  return { bytes, mimeType };
}

async function readBoundedResponse(response) {
  const contentLengthValue = response.headers.get("content-length");
  if (contentLengthValue !== null) {
    const contentLength = Number(contentLengthValue);
    if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_BYTES) {
      throw new CharacterWorkflowClientError("source preview exceeds 10 MB", { code: "invalid_source" });
    }
  }
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    ensureImageSize(bytes.length);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      byteLength += chunk.length;
      if (byteLength > MAX_SOURCE_BYTES) {
        try { await reader.cancel("source preview exceeds 10 MB"); } catch { /* ignore cancellation errors */ }
        throw new CharacterWorkflowClientError("source preview exceeds 10 MB", { code: "invalid_source" });
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  ensureImageSize(byteLength);
  return Buffer.concat(chunks, byteLength);
}

function validateImageBytes(bytes, mimeType) {
  ensureImageSize(bytes.length);
  const matches = mimeType === "image/png"
    ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mimeType === "image/jpeg"
      ? bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8
      : mimeType === "image/webp"
        ? bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP"
        : false;
  if (!matches) {
    throw new CharacterWorkflowClientError("image bytes do not match the declared image type", { code: "invalid_source" });
  }
}

function ensureImageSize(byteLength) {
  if (!byteLength || byteLength > MAX_SOURCE_BYTES) {
    throw new CharacterWorkflowClientError("source image must be between 1 byte and 10 MB", { code: "invalid_source" });
  }
}

function normalizedContentType(value) {
  return typeof value === "string" ? value.split(";", 1)[0].trim().toLowerCase() : "";
}

function isImageMimeType(value) {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

function imageExtension(mimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  throw new CharacterWorkflowClientError("unsupported image type", { code: "invalid_source" });
}

function jsonObjectField(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CharacterWorkflowClientError(`${label} must be an object`, { code: "invalid_input" });
  }
  try {
    return JSON.stringify(value);
  } catch {
    throw new CharacterWorkflowClientError(`${label} must be JSON serializable`, { code: "invalid_input" });
  }
}
