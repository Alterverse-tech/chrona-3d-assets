<div align="center">
  <h1>Your AI 3D Asset Library & Character Assistant</h1>
  <p>Find and reuse production-ready GLB assets, create and animate human characters, and upload completed character sets only when you explicitly ask.</p>
  <p>
    <a href="https://studio.13-216-49-19.sslip.io/asset-center/"><img src="docs/img/button-open-asset-center.svg" alt="Open Asset Center" width="238"></a>
    <img src="docs/img/button-use-in-codex.svg" alt="Use in Codex" width="238">
    <img src="docs/img/button-use-in-claude.svg" alt="Use in Claude" width="238">
  </p>
  <h3>Install with one prompt</h3>
  <p>Paste this into any Codex task or Claude Code session. It installs the Chrona plugin, verifies it, and then asks you to start a new task or session.</p>
</div>

```text
/goal Read https://raw.githubusercontent.com/Alterverse-tech/chrona-3d-assets/main/INSTALL.md to install the Chrona 3D Assets plugin, then set up a new task or session for me.
```

## Components and boundaries

One repository, one marketplace (`chrona-3d-assets`), and one plugin (`chrona`) containing two focused Skills:

<img src="docs/img/chrona-component-flow.png" alt="Chrona workflow: 3D Character Workflow produces human-biped character and action GLBs; after an explicit upload request, Asset Center Library publishes the completed set, then semantically recalls, previews, confirms, validates, and imports selected GLBs into a Three.js or WebGL game project" width="100%">

```text
Chrona
├── Asset Center Library
└── 3D Character Workflow
```

| Skill | Type | Owns | Authentication |
|---|---|---|---|
| `Chrona: Asset Center Library` | Skill + MCP | Asset Center boundary: explicit upload of completed Character Workflow GLBs, plus semantic recall, search, preview, confirmed selection, and safe GLB import | Asset Center OAuth / service token |
| `Chrona: 3D Character Workflow` | Skill + MCP | Human-biped production only: reference → T-Pose → GLB → rig → actions; stops when the generated files are ready | Asset Center OAuth / service token |

`3D Character Workflow` produces ready character and linked action GLBs without uploading them. If the user later explicitly asks to upload the completed set, `Asset Center Library` handles that Asset Center mutation. It also finds published assets and brings only confirmed files into a game project.

The two Skills share one install and one authentication model, but each can be used independently.

## Highlights

- **One plugin for Codex and Claude Code** — the same `plugins/chrona` package carries both host manifests, the two Skills, their MCP servers, OAuth, and the sourcing-board UI
- **Reuse before import** — search your personal library semantically, preview real candidates, and compare them in a complete ten-column asset sourcing board
- **Fresh confirmation for every task** — historical plans can help prefill a proposal, but only the active task's confirmation authorizes an import
- **Safe local integration** — confirmed GLBs are pulled into a workspace-relative package; signed download URLs never enter game code, and existing imports are tracked in `asset-center.lock.json`
- **Human-biped character production** — turn a selected person or humanoid/anime reference into a T-Pose, static GLB, rigged character, and retargeted action GLBs, then stop with preview and download deliveries
- **One shared workflow across hosts** — Codex, Claude Code, and the browser Workbench continue the same character workflow by its workflow ID
- **Separate upload boundary** — model generation, output selection, and action selection stay in 3D Character Workflow; uploading the completed set requires a later explicit request handled by Asset Center Library

<details>
<summary><b>How the two workflows look</b></summary>

### Reuse a personal asset

1. Describe the game, scene, or exact model you need.
2. Chrona reads the personal Asset Center catalog and proposes relevant reusable models and linked actions.
3. Review previews and choose one option per requirement.
4. Confirm the complete sourcing plan once; Chrona imports only the selected published GLBs.

### Create a human character

1. Provide a person or humanoid/anime reference, or ask the host to create temporary concepts.
2. Select one source before the formal 3D Character Workflow begins.
3. Review and approve the T-Pose, static model, rig, and requested actions as the workflow advances.
4. Receive preview and download links for the completed base and action GLBs. The production Skill stops here.

### Upload a completed character set

1. Explicitly ask `Asset Center Library` to upload the completed Character Workflow GLBs.
2. Chrona refreshes the exact workflow ID and verifies the ready base and action deliveries.
3. Asset Center Library publishes the linked set once and reports its Asset Center entries. Generation approval or output acceptance alone never authorizes this step.

</details>

## Installation

The one-prompt installer at the top handles both Skills. To install manually, add the marketplace and install the single `chrona` plugin.

### Codex

```bash
codex plugin marketplace add Alterverse-tech/chrona-3d-assets --ref main --json
codex plugin add chrona@chrona-3d-assets --json
```

Verify:

```bash
codex plugin marketplace list --json
codex plugin list --json
```

### Claude Code

```bash
claude plugin marketplace add Alterverse-tech/chrona-3d-assets
claude plugin install chrona@chrona-3d-assets
```

Verify:

```bash
claude plugin marketplace list
claude plugin list
```

Start a new Codex task or Claude Code session after installation so both Skills and their MCP tools are discovered.

## Asset Center Library in action

Use `Chrona: Asset Center Library` when you want to inspect or reuse published assets, or when you explicitly want to upload a completed human-character workflow to Asset Center.

```text
看看我 Asset Center 里有哪些带动画的角色。
```

```text
根据这个故事，为当前 Three.js 游戏制定资产方案，优先复用我已有的模型。
```

```text
把我那个复古飞机模型拉进当前游戏。
```

```text
把刚生成的人物和动作 GLB 上传到 Asset Center。
```

Direct lookup uses search → ambiguity confirmation when needed → workspace import. Story-driven sourcing reads the catalog once, matches models and actions in context, renders one complete proposal, and waits for one final confirmation before importing anything.

The Skill owns the Asset Center library boundary in both directions: it imports confirmed published GLBs, and it uploads a completed Character Workflow set only after an immediate explicit request. It does not generate, edit, rig, or retarget assets. Procedural-prop entries may inform a sourcing plan, but they are not downloaded as GLBs.

## 3D Character Workflow in action

Use `Chrona: 3D Character Workflow` to create a human-biped character and its action GLBs from a chosen visual reference. The Skill stops when those files are complete.

Choose **Tripo** or **Meshy-T2** once (Meshy requires your own API key). After the initial credit-use notice, T-Pose generation, static modeling, Rig Check, and rigging run automatically without intermediate acceptance prompts. The next normal pause is choosing actions; that choice starts their GLB generation. Blocking failures and paid retries still require attention, and an explicitly requested step-by-step review remains supported.

Normal runs reuse returned workflow snapshots and backend GLB validation, review the T-Pose once without a numeric score, and leave provider action-library lookup to the backend. Detailed audit logs and extra file/browser inspections are opt-in; previews and downloads are delivered together at the end. The existing best-effort plugin update check is unchanged.

<img src="docs/img/3d-character-workflow-in-action.png" alt="Chrona 3D Character Workflow in Codex and Asset Center Workbench: uploaded reference image progresses through T-Pose, 3D Model, Rigged Model, and Run and Walk action GLBs" width="100%">

<p align="center"><sub><b>上传参考图 → T-Pose → 3D Model → Rigged Model → Run / Walk 动作 GLB</b><br>Codex conversation and Asset Center Workbench advance the same workflow.</sub></p>

```text
用这张参考图创建一个可绑定的人形角色。
```

```text
为这个动漫人物生成 T-Pose、绑定骨骼，再制作 idle、walk 和 run 动作。
```

```text
继续我现有的 Character Workbench 工作流，完成角色绑定和动作 GLB。
```

The workflow supports a person or humanoid/anime character with biped proportions. Creatures, sharks, fish, quadrupeds, vehicles, props, environments, and scenes are intentionally outside this 3D Character Workflow and are never disguised as biped jobs.

Uploading is intentionally outside this Skill. After production is complete, a later explicit upload request routes to `Asset Center Library` with the existing workflow ID.

When a suitable reusable character or linked action does not exist, you can also open **[Design a Character Asset](https://studio.13-216-49-19.sslip.io/asset-center/characters/new)**. After the character and action GLBs are published, future tasks can discover them through `Asset Center Library`.

## Repository structure

```text
chrona-3d-assets/
├── .agents/plugins/marketplace.json        # Codex marketplace
├── .claude-plugin/marketplace.json         # Claude Code marketplace
├── plugins/chrona/
│   ├── .codex-plugin/plugin.json
│   ├── .claude-plugin/plugin.json
│   ├── .mcp.json
│   ├── skills/
│   │   ├── asset-center-library/
│   │   └── 3d-character-workflow/
│   ├── scripts/
│   └── web/
├── INSTALL.md
└── README.md
```

This repository is the canonical source for the `chrona` plugin. Its current public surface is exactly the two Skills documented above: `Asset Center Library` and `3D Character Workflow`.

## Access and authentication

Installation itself needs no Asset Center token. On the first authenticated Asset Center Library or 3D Character Workflow operation, Chrona opens the Asset Center OAuth flow in the browser. Tokens remain on the user's machine.

Never paste an Asset Center token into chat or source code. `ASSET_CENTER_SERVICE_TOKEN` is only an optional environment override for CI or shared runners. Character generation may use provider credits: the initial provider choice authorizes one disclosed automatic pipeline through rigging, and the later action choice authorizes animation. Paid retries are not automatic. Asset Center upload remains a separate, single-use action that requires an immediate explicit request.

## License

Free for non-commercial use. Commercial use requires prior written permission.

---

<p align="center"><strong>Create the character. Reuse the library.</strong></p>
