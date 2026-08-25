import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_MARKETPLACE_NAME = "chrona-3d-assets";
export const PLUGIN_NAME = "chrona";
export const MCP_SERVER_RELATIVE_PATH = path.join("scripts", "asset-center-library", "asset-center-personal-assets-mcp.mjs");

function versionParts(version) {
  const match = String(version ?? "").trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

export function compareSemver(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) throw new Error(`invalid semantic version: ${!a ? left : right}`);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : (a.prerelease.length === 0 ? 1 : -1);
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const av = a.prerelease[index];
    const bv = b.prerelease[index];
    if (av === undefined || bv === undefined) return av === bv ? 0 : (av === undefined ? -1 : 1);
    if (av === bv) continue;
    const an = /^\d+$/.test(av);
    const bn = /^\d+$/.test(bv);
    if (an && bn) return Number(av) - Number(bv);
    if (an !== bn) return an ? -1 : 1;
    return av.localeCompare(bv);
  }
  return 0;
}

export function runCodexCommand(args, timeoutMs, executable = "codex") {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    const append = (current, chunk) => `${current}${String(chunk)}`.slice(-1024 * 1024);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Codex plugin update timed out after ${timeoutMs}ms`));
    }, Math.max(1, timeoutMs));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`codex ${args.join(" ")} failed (${code ?? signal ?? "unknown"}): ${stderr.trim()}`));
    });
  });
}

async function defaultReadJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function defaultFileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function resolveMcpServer({
  currentPluginRoot,
  marketplaceName = DEFAULT_MARKETPLACE_NAME,
  updateTimeoutMs = 8_000,
  runCodex = runCodexCommand,
  readJson = defaultReadJson,
  fileExists = defaultFileExists,
} = {}) {
  if (!currentPluginRoot) throw new Error("currentPluginRoot is required");
  const currentServer = path.join(currentPluginRoot, MCP_SERVER_RELATIVE_PATH);
  const currentManifest = await readJson(path.join(currentPluginRoot, ".codex-plugin", "plugin.json"));
  const base = {
    serverScript: currentServer,
    updated: false,
    fromVersion: currentManifest.version,
    toVersion: currentManifest.version,
  };
  const deadline = Date.now() + updateTimeoutMs;
  const runWithinBudget = async (args) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Codex plugin update timed out after ${updateTimeoutMs}ms`);
    return runCodex(args, remaining);
  };

  try {
    await runWithinBudget(["plugin", "marketplace", "upgrade", marketplaceName, "--json"]);
    const listed = await runWithinBudget(["plugin", "list", "--marketplace", marketplaceName, "--available", "--json"]);
    const payload = JSON.parse(listed.stdout || "{}");
    const rows = [...(payload.installed ?? []), ...(payload.available ?? [])]
      .filter((row) => row?.name === PLUGIN_NAME && row?.source?.path && row?.marketplaceSource?.sourceType === "git");
    let latest = null;
    for (const row of rows) {
      const root = path.resolve(row.source.path);
      const manifest = await readJson(path.join(root, ".codex-plugin", "plugin.json"));
      if (manifest?.name !== PLUGIN_NAME || !versionParts(manifest?.version)) continue;
      if (!latest || compareSemver(manifest.version, latest.version) > 0) latest = { root, version: manifest.version };
    }
    if (!latest || compareSemver(latest.version, currentManifest.version) <= 0) {
      return { ...base, reason: "current" };
    }
    const latestServer = path.join(latest.root, MCP_SERVER_RELATIVE_PATH);
    if (!await fileExists(latestServer)) throw new Error(`updated MCP server is missing: ${latestServer}`);
    await runWithinBudget(["plugin", "add", `${PLUGIN_NAME}@${marketplaceName}`, "--json"]);
    return {
      serverScript: latestServer,
      updated: true,
      fromVersion: currentManifest.version,
      toVersion: latest.version,
      reason: "updated",
    };
  } catch (error) {
    return { ...base, reason: "fallback", warning: safeMessage(error) };
  }
}
