import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveMcpServer } from "./plugin-bootstrap-lib.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const autoUpdateDisabled = /^(0|false|off)$/i.test(process.env.ASSET_CENTER_PLUGIN_AUTO_UPDATE ?? "");
const resolution = autoUpdateDisabled
  ? {
      serverScript: path.join(pluginRoot, "scripts", "asset-center-library", "asset-center-personal-assets-mcp.mjs"),
      updated: false,
      reason: "disabled",
    }
  : await resolveMcpServer({
      currentPluginRoot: pluginRoot,
      marketplaceName: process.env.ASSET_CENTER_PLUGIN_MARKETPLACE || "chrona-3d-assets",
      updateTimeoutMs: Number(process.env.ASSET_CENTER_PLUGIN_UPDATE_TIMEOUT_MS) || 8_000,
    });

if (resolution.updated) {
  process.stderr.write(`[chrona:asset-center-library] updated ${resolution.fromVersion} -> ${resolution.toVersion}; using it now\n`);
} else if (resolution.warning) {
  process.stderr.write(`[chrona:asset-center-library] update unavailable; using bundled version (${resolution.warning})\n`);
}

const server = spawn(process.execPath, [resolution.serverScript], {
  stdio: "inherit",
  env: process.env,
  shell: false,
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => server.kill(signal));
}

server.once("error", (error) => {
  process.stderr.write(`[chrona:asset-center-library] MCP startup failed: ${error.message}\n`);
  process.exitCode = 1;
});
server.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
