#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

import { sourcingBoardHtml } from "./sourcing-board-resource.mjs";
import { buildSourcingProposal, normalizeConfirmedSourcingPlan } from "./sourcing-contract.mjs";
import { configuredServiceToken, resolveAccessToken, resolveApiBaseUrl } from "../shared/chrona-auth.mjs";

const SERVER_NAME = "chrona-asset-center-library";
const SERVER_VERSION = "0.1.7";
const PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_TARGET_DIRECTORY = "public/assets/asset-center";
const LOCK_SCHEMA = "shark.asset-center-lock/v1";
const ASSET_SCHEMA = "shark.asset-center-import/v1";
const MAX_GLB_BYTES = 512 * 1024 * 1024;

const SUITABLE_SCENES_BY_CLASSIFICATION = Object.freeze({
  人物: ["角色扮演", "剧情演出", "NPC/主角"],
  人物动作: ["角色动画", "动作复用", "交互演出"],
  汽车: ["竞速驾驶", "城市载具", "开放世界"],
  飞机: ["飞行玩法", "空战关卡", "航空载具"],
  轮船: ["航海玩法", "水上载具", "海上运输"],
  球类: ["体育玩法", "训练关卡", "互动道具"],
  建筑: ["关卡搭建", "建筑场景", "环境布置"],
  场景: ["环境搭建", "关卡背景", "空间探索"],
  普通道具: ["场景装饰", "交互玩法", "关卡物件"],
  其他: ["通用游戏场景"]
});

const SUITABLE_SCENE_CUES = Object.freeze([
  { label: "科幻太空", terms: ["太空", "宇宙", "space", "cosmic", "spacecraft", "rocket", "satellite"] },
  { label: "潜入剧情", terms: ["间谍", "潜入", "spy", "stealth"] },
  { label: "中世纪冒险", terms: ["中世纪", "骑士", "城堡", "medieval", "knight", "castle"] },
  { label: "科幻场景", terms: ["科幻", "赛博", "未来", "sci-fi", "scifi", "cyberpunk", "futuristic"] },
  { label: "海洋场景", terms: ["海洋", "海上", "航海", "ocean", "naval", "marine"] },
  { label: "城市场景", terms: ["城市", "都市", "city", "urban"] },
  { label: "体育玩法", terms: ["体育", "球场", "sport", "stadium"] },
  { label: "战斗关卡", terms: ["战斗", "武器", "combat", "battle", "weapon"] },
  { label: "竞速驾驶", terms: ["赛车", "竞速", "racing", "race"] },
  { label: "恐怖探索", terms: ["恐怖", "惊悚", "horror"] }
]);

const SOURCING_BOARD_URI = "ui://chrona/asset-center-library-v1.html";

const tools = [
  {
    name: "propose_asset_manifest",
    description: "Build a data-only asset manifest or progressive sourcing proposal after semantic matching. Call list_asset_catalog first, choose recommendations, then pass the returned proposal to render_asset_sourcing_board. This tool never imports assets.",
    inputSchema: {
      type: "object",
      properties: {
        requirements: {
          type: "array",
          minItems: 1,
          maxItems: 40,
          items: {
            type: "object",
            properties: {
              need: { type: "string", minLength: 1, maxLength: 120 },
              entityLabel: { type: "string", minLength: 1, maxLength: 40, description: "Concise 角色/实体 label. Use a short noun phrase such as 双人滑雪选手; do not append tier values such as key." },
              slotId: { type: "string", minLength: 1, maxLength: 120 },
              role: { type: "string", minLength: 1, maxLength: 80 },
              assetKind: { type: "string", minLength: 1, maxLength: 80 },
              tier: { type: "string", enum: ["key", "secondary", "environment"] },
              rigModel: { type: "string", maxLength: 80 },
              rigType: { type: "string", maxLength: 80 },
              recommendedAssetId: { type: "string" },
              alternativeAssetIds: { type: "array", items: { type: "string" }, maxItems: 5 },
              reason: { type: "string", maxLength: 200 },
              model: {
                type: "object",
                properties: {
                  defaultSource: { type: "string", enum: ["reuse_project", "reuse_asset_center", "generate_new", "primitive_fallback"] },
                  confidence: { type: "string", enum: ["high", "medium", "low", "missing"] },
                  recommendedAssetId: { type: "string" },
                  alternativeAssetIds: { type: "array", items: { type: "string" }, maxItems: 5 },
                  projectCandidates: { type: "array", items: { type: "object" }, maxItems: 5 },
                  reason: { type: "string", maxLength: 200 },
                  generator: { type: "string", maxLength: 160, description: "Generation route label, for example Gemini Reference → Tripo." },
                  scene: { type: "string", maxLength: 200, description: "The model row's 触发场景." },
                  generatedLabel: { type: "string", maxLength: 200 },
                  generatedSource: { type: "string", maxLength: 200 },
                  generatedReuseStatus: { type: "string", maxLength: 200 },
                  fallbackLabel: { type: "string", maxLength: 200 },
                  fallbackReuseStatus: { type: "string", maxLength: 200 }
                },
                required: ["defaultSource", "confidence"],
                additionalProperties: false
              },
              actions: {
                type: "array",
                maxItems: 20,
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", minLength: 1, maxLength: 120 },
                    requirement: { type: "string", maxLength: 120, description: "The 资产需求 label, for example 移动动作 or 待机动作." },
                    scene: { type: "string", minLength: 1, maxLength: 200 },
                    defaultSource: { type: "string", enum: ["reuse_linked_action", "reuse_compatible_action", "generate_action", "runtime_procedural", "primitive_fallback"] },
                    recommendedAssetId: { type: "string" },
                    alternativeAssetIds: { type: "array", items: { type: "string" }, maxItems: 5 },
                    generator: { type: "string", maxLength: 160 },
                    preset: { type: "string", maxLength: 160 },
                    cost: { type: "integer", minimum: 0 },
                    generationRoute: { type: "object" },
                    generatedLabel: { type: "string", maxLength: 200 },
                    generatedModelSource: { type: "string", maxLength: 200 },
                    generatedReuseStatus: { type: "string", maxLength: 200 },
                    runtimeLabel: { type: "string", maxLength: 200 },
                    runtimeModelSource: { type: "string", maxLength: 200 },
                    runtimeSource: { type: "string", maxLength: 200 },
                    runtimeReuseStatus: { type: "string", maxLength: 200 },
                    linkedModelSource: { type: "string", maxLength: 200 }
                  },
                  required: ["name", "scene", "defaultSource"],
                  additionalProperties: false
                }
              }
            },
            required: ["need"],
            additionalProperties: false
          }
        },
        runId: { type: "string", minLength: 1, maxLength: 160 },
        gameSummary: { type: "string", maxLength: 500 },
        note: { type: "string", maxLength: 400 }
      },
      required: ["requirements"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "render_asset_sourcing_board",
    description: "Render one prepared shark-asset-sourcing-proposal as 完整资产确认表 with exactly these columns in this order: 角色/实体、资产需求、选项、当前选择、候选方案（点击预览）、模型来源、动作、触发场景、动作来源、复用状态. Every 资产需求 is a single-choice group. Real Asset Center candidates use their HTTP/HTTPS previewUrl; missing candidates produce no placeholder row. The footer contains only 确认资产方案并开始制作 and no cost or summary statistics. Always call propose_asset_manifest first and pass its complete proposal. This tool does not query the catalog again.",
    inputSchema: {
      type: "object",
      properties: { proposal: { type: "object" } },
      required: ["proposal"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: {
      ui: { resourceUri: SOURCING_BOARD_URI, prefersBorder: false },
      "openai/outputTemplate": SOURCING_BOARD_URI,
      "openai/toolInvocation/invoking": "正在打开资产选择板…",
      "openai/toolInvocation/invoked": "资产选择板已就绪"
    }
  },
  {
    name: "confirm_asset_sourcing_plan",
    description: "Validate and freeze the user's final Widget choices as shark-asset-sourcing-plan. It does not import, generate, or modify a workspace.",
    inputSchema: {
      type: "object",
      properties: { proposal: { type: "object" }, uiState: { type: "object" } },
      required: ["proposal", "uiState"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: { "openai/widgetAccessible": true }
  },
  {
    name: "list_asset_catalog",
    description: "Fetch the user's complete personal Asset Center library grouped as Static GLB, Action GLB, and Procedural Prop. Returns a detailed Markdown recall table plus structured catalog data. Pass workspaceRoot to include import status and local modelPath. Call this FIRST when planning a game from a story or matching scene requirements to the user's assets.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 1000, default: 300 },
        workspaceRoot: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "search_personal_assets",
    description: "Keyword search over the user's published GLB assets (multi-term AND across name, prompt, semantic tags, description, animations). Returns a detailed Markdown recall table plus structured search data. Pass workspaceRoot to include import status and local modelPath. Prefer list_asset_catalog for semantic/story-driven matching; use this for a direct lookup of a known asset.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 100 },
        kind: {
          type: "string",
          enum: ["static_prop", "interactive_prop", "animated_prop", "environment", "vehicle", "character"]
        },
        hasAnimations: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 12 },
        cursor: { type: "string" },
        workspaceRoot: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "get_personal_asset",
    description: "Get immutable metadata and preview information for one personal Asset Center GLB.",
    inputSchema: {
      type: "object",
      properties: { assetId: { type: "string", minLength: 1 } },
      required: ["assetId"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "pull_asset_to_workspace",
    description: "Download and verify one personal GLB, then package it inside the requested workspace without overwriting changed assets.",
    inputSchema: {
      type: "object",
      properties: {
        assetId: { type: "string", minLength: 1 },
        workspaceRoot: { type: "string", minLength: 1 },
        targetDirectory: { type: "string", default: DEFAULT_TARGET_DIRECTORY }
      },
      required: ["assetId", "workspaceRoot"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "inspect_imported_assets",
    description: "Read the Asset Center lock file in a workspace and list locally imported assets.",
    inputSchema: {
      type: "object",
      properties: { workspaceRoot: { type: "string", minLength: 1 } },
      required: ["workspaceRoot"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }
];

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
        process.stderr.write(`[${SERVER_NAME}] ${safeErrorMessage(error)}\n`);
      });
    }
  }

  readOne() {
    const start = this.buffer.toString("utf8", 0, Math.min(this.buffer.length, 32));
    return /^Content-Length:/i.test(start) ? this.readContentLengthMessage() : this.readLineMessage();
  }

  readContentLengthMessage() {
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

  readLineMessage() {
    const newline = this.buffer.indexOf("\n");
    if (newline < 0) return null;
    const line = this.buffer.subarray(0, newline).toString("utf8").trim();
    this.buffer = this.buffer.subarray(newline + 1);
    if (!line) return this.readOne();
    return { message: JSON.parse(line), framing: "newline" };
  }
}

function writeMessage(message, framing = "newline") {
  const body = JSON.stringify(message);
  if (framing === "content-length") {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  } else {
    process.stdout.write(`${body}\n`);
  }
}

async function handleMessage(message, framing) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return;
  if (message.method.startsWith("notifications/")) return;

  try {
    let result;
    if (message.method === "initialize") {
      result = {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      };
    } else if (message.method === "ping") {
      result = {};
    } else if (message.method === "tools/list") {
      result = { tools };
    } else if (message.method === "resources/list") {
      result = {
        resources: [{
          uri: SOURCING_BOARD_URI,
          name: "Asset sourcing board",
          description: "Fullscreen progressive Widget for choosing model and action sources before import or generation.",
          mimeType: "text/html;profile=mcp-app",
          _meta: pickerResourceMeta()
        }]
      };
    } else if (message.method === "resources/read") {
      if (message.params?.uri !== SOURCING_BOARD_URI) throw new Error(`Unknown resource: ${String(message.params?.uri)}`);
      result = {
        contents: [{
          uri: SOURCING_BOARD_URI,
          mimeType: "text/html;profile=mcp-app",
          text: sourcingBoardHtml(),
          _meta: pickerResourceMeta()
        }]
      };
    } else if (message.method === "tools/call") {
      result = await callTool(message.params?.name, message.params?.arguments ?? {});
    } else {
      writeMessage({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } }, framing);
      return;
    }
    writeMessage({ jsonrpc: "2.0", id: message.id, result }, framing);
  } catch (error) {
    writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32603, message: safeErrorMessage(error) }
    }, framing);
  }
}

async function callTool(name, args) {
  try {
    let result;
    if (name === "propose_asset_manifest") result = await proposeAssetManifest(args);
    else if (name === "render_asset_sourcing_board") result = renderAssetSourcingBoard(args);
    else if (name === "confirm_asset_sourcing_plan") result = confirmAssetSourcingPlan(args);
    else if (name === "list_asset_catalog") result = await listAssetCatalog(args);
    else if (name === "search_personal_assets") result = await searchPersonalAssets(args);
    else if (name === "get_personal_asset") result = await getPersonalAsset(args);
    else if (name === "pull_asset_to_workspace") result = await pullAssetToWorkspace(args);
    else if (name === "inspect_imported_assets") result = await inspectImportedAssets(args);
    else throw new Error(`Unknown tool: ${String(name)}`);
    return toolResult(result, false);
  } catch (error) {
    return toolResult({ error: safeErrorMessage(error) }, true);
  }
}

function toolResult(result, isError) {
  return {
    content: [{ type: "text", text: !isError && typeof result?.markdown === "string" ? result.markdown : JSON.stringify(result, null, 2) }],
    structuredContent: result,
    structured_content: result,
    ...(isError ? { isError: true } : {})
  };
}

async function proposeAssetManifest(args) {
  assertPlainObject(args);
  const catalog = await apiJson("/catalog", { authenticated: true });
  return buildSourcingProposal(args, catalog);
}

function renderAssetSourcingBoard(args) {
  assertPlainObject(args);
  if (args.proposal?.schema !== "shark-asset-sourcing-proposal" || !Array.isArray(args.proposal?.slots)) {
    throw new Error("proposal must use shark-asset-sourcing-proposal");
  }
  return { proposal: args.proposal };
}

function confirmAssetSourcingPlan(args) {
  assertPlainObject(args);
  return normalizeConfirmedSourcingPlan(args.proposal, args.uiState);
}

function catalogEntries(catalog) {
  if (Array.isArray(catalog?.categories)) {
    return catalog.categories.flatMap((group) => Array.isArray(group?.assets) ? group.assets : []);
  }
  return Array.isArray(catalog?.entries) ? catalog.entries : [];
}

async function listAssetCatalog(args) {
  assertPlainObject(args);
  const params = new URLSearchParams();
  if (args.limit !== undefined) {
    if (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 1000) throw new Error("limit must be an integer from 1 to 1000");
    params.set("limit", String(args.limit));
  }
  const suffix = params.size ? `?${params}` : "";
  const catalog = await apiJson(`/catalog${suffix}`, { authenticated: true });
  return { ...catalog, markdown: await assetRecallMarkdown(catalog, args.workspaceRoot) };
}

async function searchPersonalAssets(args) {
  assertPlainObject(args);
  const params = new URLSearchParams();
  if (args.query !== undefined) params.set("q", requireString(args.query, "query", { allowEmpty: true }));
  if (args.kind !== undefined) params.set("kind", requireString(args.kind, "kind"));
  if (args.hasAnimations !== undefined) {
    if (typeof args.hasAnimations !== "boolean") throw new Error("hasAnimations must be a boolean");
    params.set("has_animations", String(args.hasAnimations));
  }
  if (args.limit !== undefined) {
    if (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 50) throw new Error("limit must be an integer from 1 to 50");
    params.set("limit", String(args.limit));
  }
  if (args.cursor !== undefined) params.set("cursor", requireString(args.cursor, "cursor"));
  const suffix = params.size ? `?${params}` : "";
  const result = await apiJson(`/assets${suffix}`, { authenticated: true });
  return { ...result, markdown: await assetRecallMarkdown(result, args.workspaceRoot) };
}

function recalledAssetEntries(result) {
  const grouped = catalogEntries(result);
  if (grouped.length) return grouped;
  if (Array.isArray(result?.assets)) return result.assets;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

async function assetRecallMarkdown(result, workspaceRoot) {
  let lock = null;
  if (workspaceRoot !== undefined) {
    const root = await resolveWorkspaceRoot(workspaceRoot);
    lock = await readLockFile(path.join(root, "asset-center.lock.json"));
  }

  const entries = recalledAssetEntries(result);
  const lines = [
    "### GLB 模型召回结果",
    "",
    "| 资产（点击预览） | 类别/类型 | 适合场景 | 动画 | 大小 | 更新时间 | 关联模型/动作 | 导入状态 | 本地 modelPath |",
    "|---|---|---|---|---|---|---|---|---|"
  ];

  if (!entries.length) {
    lines.push("| — | — | — | — | — | — | — | 未找到匹配资产 | — |");
  } else {
    for (const asset of entries) {
      const locked = lock?.assets?.[asset.id];
      lines.push(`| ${assetPreviewCell(asset)} | ${assetTypeCell(asset)} | ${assetSuitableScenesCell(asset)} | ${assetAnimationsCell(asset)} | ${assetSizeCell(asset)} | ${assetUpdatedCell(asset)} | ${assetRelationshipCell(asset)} | ${locked ? "✅ 已导入" : lock ? "未导入" : "—"} | ${locked?.modelPath ? markdownCode(locked.modelPath) : "—"} |`);
    }
  }

  const total = Number.isSafeInteger(result?.total) ? result.total : entries.length;
  const completeness = result?.truncated === false ? "完整目录" : result?.nextCursor || result?.cursor ? "仍有下一页" : "本次返回";
  lines.push("", `共 ${total} 项 · ${completeness}`);
  return lines.join("\n");
}

function markdownCell(value) {
  return String(value ?? "").replaceAll("|", "／").replaceAll("\n", " ").trim() || "—";
}

function markdownCode(value) {
  const text = markdownCell(value).replaceAll("`", "'");
  return text === "—" ? text : `\`${text}\``;
}

function assetPreviewCell(asset) {
  const name = markdownCell(asset?.displayName || asset?.name || asset?.id);
  if (typeof asset?.previewUrl !== "string") return name;
  try {
    const preview = new URL(asset.previewUrl);
    return preview.protocol === "http:" || preview.protocol === "https:" ? `[${name}](${preview.href})` : name;
  } catch {
    return name;
  }
}

function assetTypeCell(asset) {
  const category = asset?.categoryLabel || asset?.category;
  const type = asset?.classification || asset?.kind || asset?.format;
  return markdownCell([category, type].filter(Boolean).join(" / "));
}

function assetSuitableScenesCell(asset) {
  const semanticText = [
    asset?.description,
    ...(Array.isArray(asset?.tags) ? asset.tags : [])
  ].filter(Boolean).join(" ").toLocaleLowerCase("zh-CN");
  const scenes = [];
  for (const cue of SUITABLE_SCENE_CUES) {
    if (cue.terms.some((term) => semanticText.includes(term.toLocaleLowerCase("zh-CN")))) scenes.push(cue.label);
  }
  const classification = asset?.classification || inferredClassification(asset);
  scenes.push(...(SUITABLE_SCENES_BY_CLASSIFICATION[classification] ?? SUITABLE_SCENES_BY_CLASSIFICATION.其他));
  return markdownCell([...new Set(scenes)].slice(0, 3).join("、"));
}

function inferredClassification(asset) {
  if (asset?.actionId || asset?.category === "action-glb") return "人物动作";
  if (asset?.kind === "character") return "人物";
  if (asset?.kind === "environment") return "场景";
  if (["static_prop", "interactive_prop", "animated_prop", "vehicle"].includes(asset?.kind)) return "普通道具";
  return "其他";
}

function assetAnimationsCell(asset) {
  const animations = Array.isArray(asset?.animations) ? asset.animations.filter(Boolean) : [];
  if (!animations.length && asset?.actionId) animations.push(asset.actionId);
  return markdownCell(animations.join(", "));
}

function assetSizeCell(asset) {
  const bytes = Number(asset?.sizeBytes);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / 1000000).toFixed(2)} MB`;
}

function assetUpdatedCell(asset) {
  const timestamp = Date.parse(asset?.updatedAt);
  if (!Number.isFinite(timestamp)) return "—";
  return `${new Date(timestamp).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function assetRelationshipCell(asset) {
  if (asset?.parentDisplayName || asset?.parentAssetId) {
    return markdownCell(`父模型：${asset.parentDisplayName || asset.parentAssetId}`);
  }
  if (Array.isArray(asset?.actionAssetIds) && asset.actionAssetIds.length) {
    return `关联动作 ${asset.actionAssetIds.length} 个`;
  }
  return "—";
}

async function getPersonalAsset(args) {
  assertPlainObject(args);
  const assetId = requireAssetId(args.assetId);
  return apiJson(`/assets/${encodeURIComponent(assetId)}`, { authenticated: true });
}

async function pullAssetToWorkspace(args) {
  assertPlainObject(args);
  const assetId = requireAssetId(args.assetId);
  const workspaceRoot = await resolveWorkspaceRoot(args.workspaceRoot);
  const targetDirectory = validateRelativeDirectory(args.targetDirectory ?? DEFAULT_TARGET_DIRECTORY);

  const detail = await apiJson(`/assets/${encodeURIComponent(assetId)}`, { authenticated: true });
  const asset = validateAssetSummary(detail?.asset, assetId);
  if (!asset.sha256 || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes <= 0) {
    throw new Error("Asset is missing immutable SHA-256 or size metadata");
  }
  if (asset.sizeBytes > MAX_GLB_BYTES) throw new Error(`Asset exceeds the ${MAX_GLB_BYTES} byte local import limit`);

  const lockedImport = await resolveLockedImport(workspaceRoot, asset);
  if (lockedImport) {
    return { imported: false, reason: "already_imported", asset: lockedImport };
  }

  const targetRoot = await ensureContainedDirectory(workspaceRoot, targetDirectory);
  const packageName = `${slugify(asset.displayName)}--${asset.id}`;
  const packageDirectory = path.join(targetRoot, packageName);
  const relativePackageDirectory = toPosix(path.relative(workspaceRoot, packageDirectory));
  const relativeModelPath = `${relativePackageDirectory}/model.glb`;

  const existing = await readExistingImport(packageDirectory);
  if (existing) {
    if (existing.assetId !== asset.id || existing.sha256 !== asset.sha256) {
      throw new Error(`Local package ${relativePackageDirectory} already exists with different asset metadata; refusing to overwrite it`);
    }
    await updateLockFile(workspaceRoot, lockEntry(asset, relativePackageDirectory, relativeModelPath, existing.importedAt));
    return { imported: false, reason: "already_imported", asset: localAssetResult(asset, relativePackageDirectory, relativeModelPath) };
  }

  const receiptResponse = await apiJson("/import-receipts", {
    authenticated: true,
    method: "POST",
    body: { assetIds: [asset.id] }
  });
  const receipt = requireString(receiptResponse?.receipt, "receipt");
  const exchange = await apiJson(`/import-receipts/${encodeURIComponent(receipt)}/exchange`, {
    authenticated: false,
    method: "POST"
  });
  const downloadable = Array.isArray(exchange?.assets) ? exchange.assets.find((item) => item?.asset?.id === asset.id) : undefined;
  if (!downloadable) throw new Error("Import receipt exchange did not return the selected asset");

  const downloadUrl = requireString(downloadable.downloadUrl, "downloadUrl");
  const response = await fetch(downloadUrl, { redirect: "follow" });
  if (!response.ok) throw new Error(`GLB download failed with HTTP ${response.status}`);
  const bytes = await readResponseBytes(response, asset.sizeBytes);
  validateGlb(bytes, asset);

  const importedAt = new Date().toISOString();
  const metadata = {
    schema: ASSET_SCHEMA,
    assetId: asset.id,
    displayName: asset.displayName,
    kind: asset.kind,
    format: "GLB",
    sizeBytes: asset.sizeBytes,
    sha256: asset.sha256,
    updatedAt: asset.updatedAt,
    animations: asset.animations,
    ...(asset.parentAssetId ? { parentAssetId: asset.parentAssetId } : {}),
    ...(asset.parentDisplayName ? { parentDisplayName: asset.parentDisplayName } : {}),
    ...(asset.actionId ? { actionId: asset.actionId } : {}),
    ...(asset.defaultScale !== undefined ? { defaultScale: asset.defaultScale } : {}),
    ...(asset.bounds !== undefined ? { bounds: asset.bounds } : {}),
    ...(asset.rigged !== undefined ? { rigged: asset.rigged } : {}),
    localFile: "model.glb",
    importedAt
  };

  const temporaryDirectory = await fs.mkdtemp(path.join(targetRoot, ".asset-center-import-"));
  try {
    await fs.writeFile(path.join(temporaryDirectory, "model.glb"), bytes, { flag: "wx" });
    await fs.writeFile(path.join(temporaryDirectory, "asset.json"), `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });
    try {
      await fs.rename(temporaryDirectory, packageDirectory);
    } catch (error) {
      if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY") {
        throw new Error(`Local package ${relativePackageDirectory} appeared during import; refusing to overwrite it`);
      }
      throw error;
    }
  } catch (error) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }

  await updateLockFile(workspaceRoot, lockEntry(asset, relativePackageDirectory, relativeModelPath, importedAt));
  return { imported: true, asset: localAssetResult(asset, relativePackageDirectory, relativeModelPath) };
}

async function inspectImportedAssets(args) {
  assertPlainObject(args);
  const workspaceRoot = await resolveWorkspaceRoot(args.workspaceRoot);
  const lockPath = path.join(workspaceRoot, "asset-center.lock.json");
  const lock = await readLockFile(lockPath);
  return lock ?? { schema: LOCK_SCHEMA, assets: {} };
}

async function apiJson(resource, options = {}) {
  const baseUrl = apiBaseUrl();
  const headers = { accept: "application/json" };
  if (options.authenticated) headers.authorization = `Bearer ${await resolveBearerToken(options.forceFreshAuth)}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${resource}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    // OAuth 访问令牌过期/被撤销: 强制刷新一次后重试(显式 Service Token 模式不重试)
    if (response.status === 401 && options.authenticated && !options.forceFreshAuth && !envServiceToken()) {
      return apiJson(resource, { ...options, forceFreshAuth: true });
    }
    const message = typeof payload?.error === "string" ? payload.error : typeof payload?.message === "string" ? payload.message : `HTTP ${response.status}`;
    throw new Error(`Asset Center request failed: ${message}`);
  }
  return payload;
}

/** 鉴权解析: 走 Chrona 插件级统一认证(显式 Service Token > 两个 Skill 共享的 OAuth 浏览器授权登录) */
async function resolveBearerToken(forceFreshAuth = false) {
  const issuerOrigin = new URL(apiBaseUrl()).origin;
  return resolveAccessToken(issuerOrigin, { forceRefresh: forceFreshAuth });
}

function apiBaseUrl() {
  return resolveApiBaseUrl();
}

function envServiceToken() {
  return configuredServiceToken();
}

async function resolveWorkspaceRoot(value) {
  const candidate = requireString(value, "workspaceRoot");
  if (!path.isAbsolute(candidate)) throw new Error("workspaceRoot must be an absolute path");
  const realRoot = await fs.realpath(candidate);
  const stat = await fs.stat(realRoot);
  if (!stat.isDirectory()) throw new Error("workspaceRoot must point to a directory");
  return realRoot;
}

function validateRelativeDirectory(value) {
  const candidate = requireString(value, "targetDirectory").replaceAll("\\", "/");
  if (path.posix.isAbsolute(candidate) || candidate.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("targetDirectory must be a normalized relative directory without . or .. segments");
  }
  return candidate;
}

async function ensureContainedDirectory(realRoot, relativeDirectory) {
  let current = realRoot;
  for (const part of relativeDirectory.split("/")) {
    const next = path.join(current, part);
    try {
      const stat = await fs.lstat(next);
      if (stat.isSymbolicLink()) throw new Error(`targetDirectory traverses symbolic link: ${part}`);
      if (!stat.isDirectory()) throw new Error(`targetDirectory component is not a directory: ${part}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await fs.mkdir(next);
    }
    const realNext = await fs.realpath(next);
    if (!isInside(realRoot, realNext)) throw new Error("targetDirectory escapes workspaceRoot");
    current = realNext;
  }
  return current;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readExistingImport(packageDirectory) {
  let packageStat;
  try {
    packageStat = await fs.lstat(packageDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (packageStat.isSymbolicLink() || !packageStat.isDirectory()) throw new Error("Existing local package is not a regular directory");
  const metadataPath = path.join(packageDirectory, "asset.json");
  let metadataStat;
  try {
    metadataStat = await fs.lstat(metadataPath);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("Existing local package is missing asset.json");
    throw error;
  }
  if (metadataStat.isSymbolicLink() || !metadataStat.isFile()) throw new Error("Existing asset.json must be a regular file");
  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  if (metadata?.schema !== ASSET_SCHEMA) throw new Error("Existing local package has an unsupported asset.json schema");
  return metadata;
}

async function resolveLockedImport(workspaceRoot, asset) {
  const lock = await readLockFile(path.join(workspaceRoot, "asset-center.lock.json"));
  const locked = lock?.assets[asset.id];
  if (!locked) return null;
  if (locked.sha256 !== asset.sha256) {
    throw new Error(`Asset ${asset.id} has changed since it was imported; refusing to overwrite the locked local version`);
  }
  const directory = validateLockRelativePath(locked.packagePath, "packagePath");
  const model = validateLockRelativePath(locked.modelPath, "modelPath");
  if (path.posix.dirname(model) !== directory) throw new Error("Locked model path does not belong to its package directory");
  const packageDirectory = path.join(workspaceRoot, ...directory.split("/"));
  const realPackageDirectory = await fs.realpath(packageDirectory);
  if (!isInside(workspaceRoot, realPackageDirectory)) throw new Error("Locked package directory escapes workspaceRoot");
  const metadata = await readExistingImport(realPackageDirectory);
  if (!metadata || metadata.assetId !== asset.id || metadata.sha256 !== asset.sha256) {
    throw new Error(`Locked package ${directory} does not match Asset Center metadata`);
  }
  const modelPath = path.join(workspaceRoot, ...model.split("/"));
  const modelStat = await fs.lstat(modelPath);
  if (modelStat.isSymbolicLink() || !modelStat.isFile()) throw new Error("Locked model must be a regular file");
  return localAssetResult(asset, directory, model);
}

function validateLockRelativePath(value, name) {
  const candidate = requireString(value, `lock ${name}`).replaceAll("\\", "/");
  if (path.posix.isAbsolute(candidate) || candidate.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Locked ${name} is not a safe workspace-relative path`);
  }
  return candidate;
}

async function readResponseBytes(response, expectedSize) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength !== expectedSize) throw new Error("Downloaded GLB Content-Length does not match Asset Center metadata");
  if (!response.body) throw new Error("GLB download returned an empty body");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > expectedSize || total > MAX_GLB_BYTES) {
      await reader.cancel();
      throw new Error("Downloaded GLB is larger than Asset Center metadata");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function validateGlb(bytes, asset) {
  if (bytes.length !== asset.sizeBytes) throw new Error("Downloaded GLB size does not match Asset Center metadata");
  if (bytes.length < 12 || bytes.subarray(0, 4).toString("ascii") !== "glTF") throw new Error("Downloaded file is not a binary glTF (GLB)");
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest.toLowerCase() !== asset.sha256.toLowerCase()) throw new Error("Downloaded GLB SHA-256 does not match Asset Center metadata");
}

async function updateLockFile(workspaceRoot, entry) {
  const lockPath = path.join(workspaceRoot, "asset-center.lock.json");
  const existing = await readLockFile(lockPath) ?? { schema: LOCK_SCHEMA, assets: {} };
  const entries = { ...existing.assets, [entry.assetId]: entry.value };
  const assets = Object.fromEntries(Object.entries(entries).sort(([left], [right]) => left.localeCompare(right)));
  const lock = { schema: LOCK_SCHEMA, updatedAt: new Date().toISOString(), assets };
  const temporaryPath = path.join(workspaceRoot, `.asset-center.lock.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(lock, null, 2)}\n`, { flag: "wx" });
    await fs.rename(temporaryPath, lockPath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function readLockFile(lockPath) {
  try {
    const stat = await fs.lstat(lockPath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("asset-center.lock.json must be a regular file");
    const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
    if (lock?.schema !== LOCK_SCHEMA || !lock.assets || typeof lock.assets !== "object" || Array.isArray(lock.assets)) {
      throw new Error("asset-center.lock.json has an unsupported schema");
    }
    return lock;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function validateAssetSummary(value, expectedId) {
  if (!value || typeof value !== "object" || value.id !== expectedId || value.format !== "GLB") throw new Error("Asset Center returned invalid GLB metadata");
  requireString(value.displayName, "displayName");
  requireString(value.kind, "kind");
  requireString(value.updatedAt, "updatedAt");
  if (!Array.isArray(value.animations)) throw new Error("Asset Center returned invalid animation metadata");
  if (value.parentAssetId !== undefined) requireString(value.parentAssetId, "parentAssetId");
  if (value.parentDisplayName !== undefined) requireString(value.parentDisplayName, "parentDisplayName");
  if (value.actionId !== undefined) requireString(value.actionId, "actionId");
  return value;
}

function lockEntry(asset, directory, model, importedAt) {
  return {
    assetId: asset.id,
    value: {
      displayName: asset.displayName,
      kind: asset.kind,
      format: "GLB",
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      ...(asset.parentAssetId ? { parentAssetId: asset.parentAssetId } : {}),
      ...(asset.parentDisplayName ? { parentDisplayName: asset.parentDisplayName } : {}),
      ...(asset.actionId ? { actionId: asset.actionId } : {}),
      packagePath: directory,
      modelPath: model,
      importedAt
    }
  };
}

function localAssetResult(asset, directory, model) {
  return {
    assetId: asset.id,
    displayName: asset.displayName,
    kind: asset.kind,
    sha256: asset.sha256,
    sizeBytes: asset.sizeBytes,
    ...(asset.parentAssetId ? { parentAssetId: asset.parentAssetId } : {}),
    ...(asset.parentDisplayName ? { parentDisplayName: asset.parentDisplayName } : {}),
    ...(asset.actionId ? { actionId: asset.actionId } : {}),
    packagePath: directory,
    modelPath: model
  };
}

function slugify(value) {
  const slug = value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return slug || "asset";
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function requireAssetId(value) {
  const assetId = requireString(value, "assetId");
  if (!/^(?:ast|legacy)_[A-Za-z0-9._-]{1,180}$/.test(assetId)) throw new Error("assetId is invalid");
  return assetId;
}

function requireString(value, name, options = {}) {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  const text = value.trim();
  if (!options.allowEmpty && !text) throw new Error(`${name} is required`);
  return text;
}

function assertPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool arguments must be an object");
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// Resource-level UI metadata (per the MCP Apps contract, the resource carries
// prefersBorder + CSP allowlists; preview images load from the studio origin).
function pickerResourceMeta() {
  let origin;
  try {
    origin = new URL(apiBaseUrl()).origin;
  } catch {
    origin = undefined;
  }
  return {
    ui: {
      prefersBorder: true,
      ...(origin ? { csp: { connectDomains: [], resourceDomains: [origin], frameDomains: [origin] } } : {})
    }
  };
}

// Self-contained MCP Apps component (text/html;profile=mcp-app). It renders the
// propose_asset_manifest result as selectable cards and reports the confirmed
// selection back through ui/update-model-context. The bridge handling is
// defensive: hosts that never deliver a tool result simply leave the shell
// empty, and non-UI hosts ignore this resource entirely.
function manifestPickerHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: light dark; font-family: system-ui, -apple-system, sans-serif; }
  body { margin: 0; padding: 12px; }
  h3 { margin: 0 0 10px; font-size: 15px; }
  .req { margin-bottom: 14px; }
  .need { font-weight: 600; font-size: 13px; margin-bottom: 6px; }
  .cards { display: flex; flex-wrap: wrap; gap: 8px; }
  .card { border: 1px solid rgba(128,128,128,.35); border-radius: 10px; padding: 8px; width: 168px; cursor: pointer; }
  .card.selected { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,.25); }
  .card .preview { width: 100%; height: 84px; overflow: hidden; border-radius: 6px; background: rgba(128,128,128,.15); }
  .card .preview img { width: 100%; height: 100%; display: block; object-fit: cover; }
  .card .preview iframe { width: 100%; height: 100%; display: block; border: 0; }
  .card .preview-empty { display: grid; place-items: center; font-size: 11px; opacity: .65; }
  .card .name { font-size: 12px; font-weight: 600; margin: 6px 0 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card .desc { font-size: 11px; opacity: .7; margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .card .meta { font-size: 11px; opacity: .75; }
  .badge { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 999px; background: rgba(37,99,235,.12); color: #2563eb; margin-right: 4px; }
  .missing { font-size: 12px; opacity: .7; font-style: italic; }
  footer { margin-top: 12px; display: flex; gap: 8px; align-items: center; }
  button { border: 0; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; background: #2563eb; color: #fff; }
  #status { font-size: 12px; opacity: .75; }
</style>
</head>
<body>
<h3>资产清单确认 · Asset Manifest</h3>
<div id="root"><p class="missing">等待清单数据…</p></div>
<footer><button id="confirm" hidden>确认选择</button><span id="status"></span></footer>
<script>
(function () {
  var manifest = null;
  var selection = new Map();
  var requestId = 0;

  function send(method, params) {
    requestId += 1;
    window.parent.postMessage({ jsonrpc: "2.0", id: requestId, method: method, params: params || {} }, "*");
  }

  // Host -> iframe bridge: JSON-RPC 2.0 over postMessage. ui/initialize is a
  // host-initiated request we must answer; tool data arrives as notifications
  // with structuredContent directly on params.
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.method === "ui/initialize" && message.id !== undefined) {
      window.parent.postMessage({ jsonrpc: "2.0", id: message.id, result: {} }, "*");
      return;
    }
    if (message.method === "ui/notifications/tool-result" || message.method === "ui/notifications/tool-input") {
      var params = message.params || {};
      var structured = params.structuredContent || params.structured_content
        || (params.result && (params.result.structuredContent || params.result.structured_content));
      if (structured && Array.isArray(structured.manifest)) render(structured);
    }
  }, { passive: true });

  // ChatGPT window.openai shims: prefer them when present (feature-detect).
  if (window.openai && window.openai.toolOutput) {
    var output = window.openai.toolOutput;
    var structuredOutput = output.structuredContent || output.structured_content || output;
    if (structuredOutput && Array.isArray(structuredOutput.manifest)) render(structuredOutput);
  }

  function persistSelection() {
    if (window.openai && typeof window.openai.setWidgetState === "function") {
      var snapshot = {};
      selection.forEach(function (assetId, index) { snapshot[index] = assetId; });
      window.openai.setWidgetState({ selection: snapshot });
    }
  }

  function restoredSelection() {
    var state = window.openai && window.openai.widgetState;
    return state && state.selection && typeof state.selection === "object" ? state.selection : null;
  }

  function renderPreview(preview, entry) {
    function showEmpty(label) {
      preview.innerHTML = "";
      preview.classList.add("preview-empty");
      preview.textContent = label;
    }

    function showModelViewer() {
      if (!entry.previewUrl) {
        showEmpty("暂无预览");
        return;
      }
      preview.innerHTML = "";
      preview.classList.remove("preview-empty");
      var frame = document.createElement("iframe");
      frame.loading = "lazy";
      frame.title = entry.displayName + " 3D 预览";
      frame.referrerPolicy = "no-referrer";
      frame.sandbox = "allow-scripts allow-same-origin";
      frame.src = entry.previewUrl;
      preview.appendChild(frame);
    }

    if (!entry.thumbnailUrl) {
      showModelViewer();
      return;
    }

    var img = document.createElement("img");
    img.loading = "lazy";
    img.alt = entry.displayName;
    img.addEventListener("error", showModelViewer, { once: true });
    img.src = entry.thumbnailUrl;
    preview.appendChild(img);
  }

  function render(data) {
    manifest = data.manifest;
    selection = new Map();
    var restored = restoredSelection();
    var root = document.getElementById("root");
    root.innerHTML = "";
    manifest.forEach(function (requirement, index) {
      var section = document.createElement("div");
      section.className = "req";
      var need = document.createElement("div");
      need.className = "need";
      need.textContent = requirement.need + (requirement.reason ? " — " + requirement.reason : "");
      section.appendChild(need);
      var cards = document.createElement("div");
      cards.className = "cards";
      var candidates = (requirement.recommended ? [requirement.recommended] : []).concat(requirement.alternatives || []);
      if (candidates.length === 0) {
        var missing = document.createElement("p");
        missing.className = "missing";
        missing.textContent = "缺失 — 建议到资产中心生成";
        section.appendChild(missing);
      }
      candidates.forEach(function (entry, candidateIndex) {
        var card = document.createElement("div");
        card.className = "card";
        var preview = document.createElement("div");
        preview.className = "preview";
        renderPreview(preview, entry);
        card.appendChild(preview);
        var name = document.createElement("div");
        name.className = "name";
        name.textContent = entry.displayName;
        card.appendChild(name);
        if (entry.description) {
          var desc = document.createElement("div");
          desc.className = "desc";
          desc.textContent = entry.description;
          card.appendChild(desc);
        }
        var meta = document.createElement("div");
        meta.className = "meta";
        var badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = entry.categoryLabel || entry.category;
        meta.appendChild(badge);
        var details = [];
        if (entry.classification) details.push(entry.classification);
        if (entry.animations && entry.animations.length) details.push(entry.animations.slice(0, 3).join("/"));
        if (entry.sizeBytes) details.push((entry.sizeBytes / 1e6).toFixed(1) + "MB");
        if (details.length) meta.appendChild(document.createTextNode(details.join(" · ")));
        card.appendChild(meta);
        var restoredChoice = restored ? restored[String(index)] : undefined;
        var initiallySelected = restored ? restoredChoice === entry.id : candidateIndex === 0 && Boolean(requirement.recommended);
        if (initiallySelected) {
          selection.set(index, entry.id);
          card.classList.add("selected");
        }
        card.addEventListener("click", function () {
          if (selection.get(index) === entry.id) selection.delete(index);
          else selection.set(index, entry.id);
          Array.prototype.forEach.call(cards.children, function (sibling) { sibling.classList.remove("selected"); });
          if (selection.has(index)) card.classList.add("selected");
          persistSelection();
        });
        cards.appendChild(card);
      });
      section.appendChild(cards);
      root.appendChild(section);
    });
    document.getElementById("confirm").hidden = false;
  }

  document.getElementById("confirm").addEventListener("click", function () {
    if (!manifest) return;
    var selected = [];
    manifest.forEach(function (requirement, index) {
      if (selection.has(index)) selected.push({ need: requirement.need, assetId: selection.get(index) });
    });
    persistSelection();
    var summary = "用户已在资产清单选择器中确认选择: " + JSON.stringify({ selected: selected }) + "。请对选中的 assetId 依次调用 pull_asset_to_workspace。";
    send("ui/update-model-context", { content: [{ type: "text", text: summary }] });
    if (window.openai && typeof window.openai.sendFollowUpMessage === "function") {
      window.openai.sendFollowUpMessage("我已确认资产清单选择（" + selected.length + " 项），请开始导入。");
    } else {
      send("ui/message", { content: [{ type: "text", text: "我已确认资产清单选择（" + selected.length + " 项），请开始导入。" }] });
    }
    document.getElementById("status").textContent = "已提交 " + selected.length + " 项选择，请回到对话继续。";
  });
})();
</script>
</body>
</html>`;
}

const reader = new StdioJsonRpcReader(handleMessage);
process.stdin.on("data", (chunk) => reader.push(chunk));
process.stdin.on("error", (error) => process.stderr.write(`[${SERVER_NAME}] ${safeErrorMessage(error)}\n`));
process.stdin.resume();
