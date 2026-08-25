import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(root, "dist");
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [path.join(root, "src", "AssetSourcingBoard.tsx")],
  outfile: path.join(outdir, "asset-sourcing-board.js"),
  bundle: true,
  format: "esm",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  jsx: "automatic",
  charset: "utf8",
});
