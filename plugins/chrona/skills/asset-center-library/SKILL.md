---
name: asset-center-library
description: Use when a Codex game project needs to find, preview, choose, import, or inspect the current user's personal GLB models from Asset Center — including when the user describes a game/story to build and their existing assets should become development context.
---

# Asset Center Library

Use the Asset Center MCP tools to bring the user's own models into the game as immutable, verified local GLB packages. Treat the local package and lock file as the integration boundary.

## Two entry modes

**A. 直接找模型（direct lookup）** — the user names a specific asset ("把我那个复古飞机拉进来"): `search_personal_assets` → confirm if ambiguous → `pull_asset_to_workspace`.

**B. 剧本/需求驱动（story-driven manifest）** — the user describes a game, story, or scene to build ("根据这个剧本做一个 threejs 游戏"). Follow the manifest workflow below. This mode is the default whenever game development starts and the user's library may be relevant.

## GLB recall output

For every read-only request to list, search, recall, or inspect personal models, pass `workspaceRoot` when the current project is known and render the tool's Markdown text result before any prose summary. Keep exactly these columns: 资产（点击预览）、类别/类型、适合场景、动画、大小、更新时间、关联模型/动作、导入状态、本地 modelPath. The Plugin derives 适合场景 from `description`, `classification`, and `tags`; structured results retain asset IDs and rig metadata for semantic matching and integration. Preserve the structured result for pagination. Never replace the table with a names-only list or raw JSON.

## Current-task confirmation and game-intent boundary

Never use confirmation metadata read from the workspace to satisfy the current asset-sourcing confirmation gate. `asset-sourcing-plan.json` is a historical selection snapshot, not current-task authorization.

Before using any historical plan, compare the current project/game directory, game summary, model slots, roles, asset kinds, semantic actions, and explicit continuation wording. Classify it conservatively:

- `active_same_task`: the current conversation already contains the Widget confirmation for the same game intent; continue with that confirmed selection.
- `related_history`: the history describes the same game, but this task has no live confirmation; use it only to prefill a newly rendered board.
- `unrelated_history`: the current game or critical entity/action requirements differ; ignore the historical choices.
- `uncertain`: relevance cannot be established; treat it as unrelated and start from fresh recommendations.

Shared asset names, a shared repository, or generic entities such as a character, car, or airplane are not sufficient evidence of the same game. Explicit "continue/resume the previous game" wording is strong relevance evidence, but without a live confirmation in the active task it still permits prefill only. New proposals carry an `intentSnapshot`; historical files without one are `uncertain`.

## Manifest workflow (mode B)

1. **Extract requirements.** From the story/prompt, list the entities the game needs: characters (+ required actions like walk/run/attack), props, environment pieces, vehicles.
2. **Read the library once.** Call `list_asset_catalog`. The response is grouped in this fixed order: 静态 GLB → 动作 GLB → 程序道具. Each entry carries life `classification` (人物、人物动作、汽车、飞机、轮船、球类等), semantic `tags`, `description`, `animations`, and `sizeBytes`. A rigged character root remains a 静态 GLB; each independent action GLB is a separate 动作 GLB linked by `parentAssetId`. Match entries to requirements **semantically in-context** — synonyms, 中英互通, style hints. Do not fire many keyword searches.
3. **Build the sourcing proposal.** Call `propose_asset_manifest` with the model/action requirements, default source, recommendations, alternatives, reasons, confidence, and action scenes. For every model include `model.scene`; use the optional model/action presentation strings when the business wording needs to be exact (`generatedLabel`, `generatedSource`, `generatedReuseStatus`, `fallbackLabel`, `fallbackReuseStatus`, action `requirement`, `runtimeLabel`, `runtimeModelSource`, `runtimeSource`, `runtimeReuseStatus`, `generatedModelSource`, and `generatedReuseStatus`). It is a data tool: it fetches the catalog exactly once and returns either the legacy manifest shape or `shark-asset-sourcing-proposal`. A catalog query failed result must be reported as `query failed / 库存查询失败或暂不可用`; never turn an API/auth failure into “no assets”.

4. **Render one complete asset confirmation table.** Give every sourcing requirement a concise noun-phrase `entityLabel` (for example `双人滑雪选手`); never copy the full requirement description or append internal tier values such as `(key)`. Pass the complete proposal to `render_asset_sourcing_board`. In MCP-Apps-capable hosts this opens a Widget with exactly these columns and this order: 角色/实体、资产需求、选项、当前选择、候选方案（点击预览）、模型来源、动作、触发场景、动作来源、复用状态. Character and creature model groups use 人物/主体; non-living groups use 道具 and their action requirements use 道具动作. Each 资产需求 is one single-choice group. Any real reusable candidate name with a safe HTTP/HTTPS `previewUrl` is a native link: a left-click opens it in Codex Browser and a right-click uses the host's native link menu, including the system-browser option; absent candidates have no placeholder row. The Widget does not embed preview iframes. Its explicit 刷新资产 button sends a follow-up request to reload the complete Asset Center catalog and rebuild the proposal without importing or generating; 全屏查看 may request fullscreen only from that user click, and inline mode remains usable when the host declines. In plain hosts, render the same structured proposal as a markdown table:

   | 角色/实体 | 资产需求 | 选项 | 当前选择 | 候选方案（点击预览） | 模型来源 | 动作 | 触发场景 | 动作来源 | 复用状态 |
   |---|---|---|---|---|---|---|---|---|---|
   | 主角骑士（key） | 人物/主体 | A | ☑ 推荐 | 生成原创主角骑士 | 新生成 · Gemini Reference → Tripo | — | 玩家进入城堡 | — | 原创主模型 |
   | 〃 | 人物/主体 | B | ☐ | [复用素材: Rusty Knight(点击预览)](https://example.invalid/preview) ↗ | Asset Center 静态 GLB | — | 玩家进入城堡 | — | 候选复用 |
   | 〃 | 人物/主体 | C | ☐ | 使用three.js程序生成 | 程序模型 | — | 玩家进入城堡 | — | — |
   | 主角骑士（key） | 移动动作 | A | ☑ 推荐 | 新生成人物/主体静态 GLB → 新生成 `walk` 动作 GLB | 新生成人物/主体静态 GLB | walk | 第三人称移动探索 | Tripo 重定向 · 新静态 GLB → 新动作 GLB · `preset:biped:walk` | 新人物/主体与新动作成套生成 |

   Fix these interaction rules: every 资产需求 group has exactly one selected row; the recommended row is the default but can be changed; only real `previewUrl` values create ↗ links; changing the base resets incompatible action choices; linked actions are enabled only for their corresponding Asset Center base; high-confidence reuse moves to A and becomes recommended, otherwise generation is A and recommended; and the footer contains only `确认资产方案并开始制作` with no cost or summary statistics.

   Default recommendation = the best match per requirement; list runners-up as 备选. A static character GLB remains useful even when no action GLB matches, because the user may choose a supported generated-action route or runtime action.
5. **Wait for one final confirmation.** The only primary action is `确认资产方案并开始制作`. The Widget calls `confirm_asset_sourcing_plan`, which validates and freezes the complete choice set but does not import or generate. In plain hosts, obtain the same one final confirmation in chat. Never import before this confirmation.
6. **Import only the confirmed reuse set.** Call `pull_asset_to_workspace` once per final `reuse_asset_center` model/action (`public/assets/asset-center` when the project has `public/`; otherwise `assets/asset-center`). Then return each verified `modelPath`, SHA-256, and size to the orchestrator. Generation and runtime decisions remain context for Shark Game Assets; this Plugin does not execute them.
7. **Report gaps.** Return final `generate_new`, `generate_action`, runtime, and fallback choices to the orchestrator. 程序道具 catalog entries are context only — mention them when relevant, do not pull them.

   When a character has no suitable reusable base model, the selected model is `generate_new`, or a selected character lacks linked action candidates, show one non-blocking recommendation to [设计人物资产](https://studio.13-216-49-19.sslip.io/asset-center/characters/new). Explain that after the user designs and publishes the character plus its action GLBs, future game tasks can semantically recommend the static character and its `parentAssetId`-linked actions. Do not open the page automatically and do not imply that visiting it alone creates or publishes an action.

## Rules

- Authentication needs no configuration: the first library request opens Asset Center's authorization page in the user's browser (Google or email code), and tokens stay on their machine. If a request reports pending authorization, tell the user to finish the page that just opened; when no browser appeared, give them the authorization link printed on stderr. Never ask the user to paste a Service Token or any token into chat or source code — `ASSET_CENTER_SERVICE_TOKEN` is only an optional environment override for CI or shared runners.
- Do not pull assets merely because they matched. Pull only what the user confirmed.
- A `reuse_linked_action` must have `parentAssetId` equal to the selected base character asset id. Clear the old action choice whenever the base changes. Cross-character reuse requires verified compatibility evidence.
- Never use a signed download URL in game code. The pull tool exchanges it internally and returns only workspace-relative paths.
- Do not overwrite an existing package when its SHA-256 differs. Surface the conflict and ask whether the user wants a separately named/versioned import.
- Preserve `asset-center.lock.json`; use `inspect_imported_assets` to understand existing imports before proposing a manifest (already-imported assets show as ✅ 已导入, no re-pull).
- This plugin imports published GLBs. It does not generate, edit, upload, or publish assets.

## Common prompts

- “根据这个故事做一个 threejs 小游戏。”（→ manifest workflow）
- “看看我资产中心里有哪些带动画的角色。”
- “把我那个复古飞机模型拉进当前游戏。”
- “列一下这个项目已经导入的 Asset Center 模型。”
