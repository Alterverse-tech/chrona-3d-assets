#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE_URL = (process.env.MESHY_BASE_URL || "https://api.meshy.ai").replace(/\/+$/, "");
const POLL_MS = Math.max(1000, Number(process.env.MESHY_POLL_MS) || 5000);
const MAX_POLL_MS = Math.max(POLL_MS, Number(process.env.MESHY_MAX_POLL_MS) || 30 * 60 * 1000);

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

if (!command || args.help || args.h) {
  printUsage();
  process.exit(command ? 0 : 2);
}

if (command === "rig-check") {
  const report = await preflightGlb(requireText(args.input, "--input"));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.passed ? 0 : 1);
}

const apiKey = (process.env.MESHY_API_KEY || "").trim();
if (!apiKey) fail("MESHY_API_KEY is required; do not pass the key as a command-line argument.");

if (command === "model") {
  const result = await createModel({ input: requireText(args.input, "--input"), outputDir: outputDir(args), targetPolycount: optionalInteger(args["target-polycount"]) });
  printResult(result);
} else if (command === "rig") {
  const result = await createRig({ modelTaskId: args["model-task-id"], modelPath: args.input, outputDir: outputDir(args), heightMeters: optionalNumber(args.height) ?? 1.7 });
  printResult(result);
} else if (command === "animate") {
  const result = await createAnimations({ rigTaskId: requireText(args["rig-task-id"], "--rig-task-id"), actions: String(args.actions || args.action || "run").split(",").map((value) => value.trim()).filter(Boolean), outputDir: outputDir(args) });
  printResult(result);
} else if (command === "pipeline") {
  const result = await runPipeline({ input: requireText(args.input, "--input"), outputDir: outputDir(args), actions: String(args.actions || args.action || "run").split(",").map((value) => value.trim()).filter(Boolean), targetPolycount: optionalInteger(args["target-polycount"]), heightMeters: optionalNumber(args.height) ?? 1.7 });
  printResult(result);
} else if (command === "library") {
  const category = args.category ? `?category=${encodeURIComponent(args.category)}` : "";
  console.log(JSON.stringify(await request(`/openapi/v1/animations/library${category}`, { method: "GET" }), null, 2));
} else {
  fail(`Unknown command: ${command}`);
}

async function runPipeline({ input, outputDir, actions, targetPolycount, heightMeters }) {
  const model = await createModel({ input, outputDir, targetPolycount });
  const check = await preflightGlb(model.file);
  if (!check.passed) fail(`Meshy Rig Check failed: ${check.issues.join("; ")}`);
  const rig = await createRig({ modelTaskId: model.taskId, outputDir, heightMeters });
  const animations = await createAnimations({ rigTaskId: rig.taskId, actions, outputDir });
  return { provider: "meshy", model, rigCheck: check, rig, animations };
}

async function createModel({ input, outputDir, targetPolycount }) {
  const image = await readImageDataUri(input);
  const body = {
    image_url: image,
    model_type: "smart-topology",
    ai_model: "meshy-t2",
    should_texture: true,
    enable_pbr: true,
    target_formats: ["glb"],
    ...(targetPolycount ? { target_polycount: targetPolycount } : {})
  };
  const created = await request("/openapi/v1/image-to-3d", { method: "POST", body });
  const task = await poll(`/openapi/v1/image-to-3d/${created.result}`);
  const file = await download(task.model_urls?.glb, path.join(outputDir, "meshy-t2-static.glb"));
  return { taskId: task.id, file, consumedCredits: task.consumed_credits };
}

async function createRig({ modelTaskId, modelPath, outputDir, heightMeters }) {
  const body = modelTaskId
    ? { input_task_id: requireText(modelTaskId, "--model-task-id"), height_meters: heightMeters }
    : { model_url: await readBinaryDataUri(requireText(modelPath, "--input")), height_meters: heightMeters };
  const created = await request("/openapi/v1/rigging", { method: "POST", body });
  const task = await poll(`/openapi/v1/rigging/${created.result}`);
  const file = await download(task.result?.rigged_character_glb_url, path.join(outputDir, "meshy-rigged.glb"));
  return { taskId: task.id, file, consumedCredits: task.consumed_credits };
}

async function createAnimations({ rigTaskId, actions, outputDir }) {
  const library = await request("/openapi/v1/animations/library?category=WalkAndRun", { method: "GET" });
  const outputs = [];
  for (const action of actions) {
    const actionId = resolveActionId(library, action);
    const created = await request("/openapi/v1/animations", { method: "POST", body: { rig_task_id: rigTaskId, action_id: actionId } });
    const task = await poll(`/openapi/v1/animations/${created.result}`);
    const safeName = slug(action);
    const file = await download(task.result?.animation_glb_url, path.join(outputDir, `meshy-${safeName}.glb`));
    outputs.push({ requestedAction: action, actionId, taskId: task.id, file, consumedCredits: task.consumed_credits });
  }
  return outputs;
}

async function poll(route) {
  const started = Date.now();
  while (Date.now() - started <= MAX_POLL_MS) {
    const task = await request(route, { method: "GET" });
    if (task.status === "SUCCEEDED") return task;
    if (["FAILED", "CANCELED", "EXPIRED"].includes(task.status)) {
      fail(`Meshy task ${task.status}: ${task.task_error?.message || "unknown provider error"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  fail(`Meshy task polling timed out after ${Math.round(MAX_POLL_MS / 60000)} minutes`);
}

async function request(route, { method, body }) {
  const response = await fetch(`${BASE_URL}${route}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.MESHY_API_KEY}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) fail(`Meshy API ${response.status}: ${redact(payload.message || payload.error?.message || text || "request failed")}`);
  return payload;
}

async function download(url, destination) {
  if (typeof url !== "string" || !url) fail("Meshy task succeeded without a downloadable GLB URL");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) fail(`Meshy result download failed (HTTP ${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destination, bytes, { mode: 0o600 });
  return destination;
}

async function preflightGlb(input) {
  const bytes = await fs.readFile(input);
  const issues = [];
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) issues.push("not a GLB 2.0 file");
  const json = readGlbJson(bytes);
  if (!json) issues.push("missing readable glTF JSON chunk");
  if (json && (!Array.isArray(json.meshes) || json.meshes.length === 0)) issues.push("no mesh found");
  const faceCount = json ? estimateFaceCount(json) : undefined;
  if (faceCount !== undefined && faceCount > 300000) issues.push(`face count ${faceCount} exceeds Meshy's 300,000-face rigging limit`);
  if (json && (!Array.isArray(json.images) || json.images.length === 0) && (!Array.isArray(json.materials) || json.materials.length === 0)) issues.push("no texture/material data found; Meshy rigging expects a textured humanoid");
  return { passed: issues.length === 0, file: input, bytes: bytes.length, faceCount, meshCount: json?.meshes?.length ?? 0, issues };
}

function readGlbJson(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67) return undefined;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) return JSON.parse(chunk.toString("utf8").replace(/\0+$/, "").trim());
    offset += 8 + length;
  }
  return undefined;
}

function estimateFaceCount(json) {
  if (!Array.isArray(json.meshes)) return undefined;
  let faces = 0;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives || []) {
    if (primitive.mode && primitive.mode !== 4) continue;
    const accessor = json.accessors?.[primitive.indices];
    if (accessor?.count) faces += Math.floor(accessor.count / 3);
  }
  return faces || undefined;
}

function resolveAction(library, requested) {
  const numeric = Number(requested);
  if (Number.isInteger(numeric) && numeric >= 0) return numeric;
  const needle = requested.toLowerCase().replace(/[^a-z0-9]/g, "");
  const exact = library.find((item) => [item.name, item.key].filter(Boolean).some((value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, "") === needle));
  const fuzzy = library.find((item) => [item.name, item.key].filter(Boolean).some((value) => String(value).toLowerCase().includes(requested.toLowerCase())));
  const match = exact || fuzzy;
  if (!match) fail(`No Meshy animation matches '${requested}'. Run the library command to inspect available actions.`);
  return match.action_id;
}

async function readImageDataUri(file) {
  const bytes = await fs.readFile(file);
  const ext = path.extname(file).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function readBinaryDataUri(file) {
  const bytes = await fs.readFile(file);
  return `data:model/gltf-binary;base64,${bytes.toString("base64")}`;
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item.startsWith("--")) {
      const key = item.slice(2);
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) { result[key] = next; index += 1; } else result[key] = true;
    } else result._.push(item);
  }
  return result;
}

function outputDir(input) { return path.resolve(String(input["output-dir"] || "meshy-character-output")); }
function requireText(value, flag) { if (typeof value !== "string" || !value.trim()) fail(`${flag} is required`); return value; }
function optionalInteger(value) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined; }
function optionalNumber(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined; }
function slug(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "action"; }
function redact(value) { return String(value).replace(/msy_[A-Za-z0-9_-]+/g, "msy_[redacted]"); }
function fail(message) { console.error(redact(message)); process.exit(1); }
function printResult(result) { console.log(JSON.stringify(result, null, 2)); }
function printUsage() { console.log("Usage: MESHY_API_KEY=... node meshy-character-workflow.mjs <model|rig-check|rig|animate|pipeline|library> ..."); }
