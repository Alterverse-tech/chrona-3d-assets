import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const jsPath = fileURLToPath(new URL("../../web/dist/asset-sourcing-board.js", import.meta.url));
const cssPath = fileURLToPath(new URL("../../web/dist/asset-sourcing-board.css", import.meta.url));

export function sourcingBoardHtml() {
  const js = readFileSync(jsPath, "utf8").replaceAll("</script", "<\\/script");
  const css = readFileSync(cssPath, "utf8").replaceAll("</style", "<\\/style");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="ui-library" content="@openai/apps-sdk-ui"><meta name="confirmation-label" content="确认资产方案并开始制作"><style>${css}</style></head><body><div id="root"></div><script type="module">${js}</script></body></html>`;
}
