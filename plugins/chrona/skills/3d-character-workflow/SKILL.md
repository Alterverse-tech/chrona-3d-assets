---
name: 3d-character-workflow
description: Use when a user asks Codex Desktop or Claude Code to create a human-biped character through reference selection, T-Pose, GLB generation, rigging, and action GLBs with Meshy-T2 or Tripo, or to continue that production workflow. Stop when the generated files are complete; Asset Center upload belongs to asset-center-library.
---

# 3D Character Workflow

## Overview

Own only the human-biped production side: `reference → T-Pose → Image-to-Model → static GLB → Rig Check → rig → actions`. Keep the conversation and temporary concepts in the native agent host, use the shared Character Workbench after the user selects one supported reference, and stop when the generated static, rigged, and selected action GLBs are complete.

This skill never uploads completed GLBs to the Asset Center library. If the user later explicitly asks to upload them, hand the existing `workflowId` to `asset-center-library`; do not perform the upload from this skill.

## Best-effort update check

This loaded Chrona plugin bundle is version `0.1.5`. On the first use of this skill in each new task, make one non-blocking update check for the current host only:

- Give the shell call a five-second timeout. In Codex, refresh `chrona-3d-assets` with `codex plugin marketplace upgrade chrona-3d-assets --json`; in Claude Code, use `claude plugin marketplace update chrona-3d-assets`.
- Read the configured marketplace root from that host's JSON marketplace list, then read the `chrona` version from `.agents/plugins/marketplace.json` for Codex or `.claude-plugin/marketplace.json` for Claude Code.
- Only when the refreshed manifest contains a valid semantic version greater than `0.1.5`, append one short, non-blocking notice that names the available version and asks the user to say `更新插件`. Continue the character request without waiting.
- If the command fails, times out, lacks credentials, returns invalid data, or does not prove a newer version, continue silently. Do not retry or claim the plugin is current.

Never clone or pull a repository, create a scheduler, edit plugin caches, or update both hosts during this check. Only after the user explicitly asks to update, run `codex plugin add chrona@chrona-3d-assets --json` in Codex or `claude plugin update chrona@chrona-3d-assets --scope user` in Claude Code. Tell the user the new version loads in the next task or session.

## Route the request

Classify before calling a write tool:

- `human_biped`: one intended person or humanoid/anime character with biped proportions.
- `creature`: shark, fish, quadruped, monster anatomy, or non-biped rig. Explain that the creature production profile is not available yet. Do not create a biped workflow.
- `other`: prop, vehicle, environment, or scene. Use the matching Asset Center route when available; do not disguise it as a character workflow.
- `ambiguous`: ask one focused question about the intended subject or output.

## Prepare and select the source

For a text-only human request, use the host's installed image-generation capability to create one to three temporary, full-character concepts. Show them in native chat and wait for the user to select one.

For an attached human image:

- If the user says to use it exactly, present it as the sole candidate and ask for confirmation.
- If the user asks for visual changes, create temporary variants and wait for a choice.
- If image generation is unavailable, ask for a local reference image. Never fabricate a file path.

Temporary candidates are not workflow artifacts. Do not call `create_character_workflow` before a choice. Upload only the selected image with `attach_character_source`.

## Choose the 3D provider before generation

Before starting `Image-to-Model`, ask the user to choose exactly one provider and keep that provider for every later 3D stage:

1. `Meshy (Meshy-T2)` — the user must provide their own Meshy API key when the workflow is created. The backend encrypts it at rest and never returns it in workflow snapshots. For the standalone fallback script, use `MESHY_API_KEY`; never write the key into this skill, source files, logs, or the final response.
2. `Tripo` — use the existing Asset Center/Tripo route and its configured key pool.

The provider choice is sticky for the workflow. Do not generate the static model with Meshy and then silently send it to Tripo for rigging or animation, or the reverse. If the user has not chosen a provider, stop before any paid 3D request and ask the one focused choice question.

When Meshy is selected, read [references/meshy-provider.md](references/meshy-provider.md) for the official endpoint mapping. The shared Asset Center backend owns the provider calls and keeps the workflow artifacts, task IDs, previews, and credit metadata in one workflow. Meshy has no separate free Rig Check endpoint: the shared `rig-check` stage performs a local GLB preflight, then Meshy's `rig` task performs provider-side pose/rig validation. Use the standalone `meshy-character-workflow.mjs` script only as a fallback outside the shared Asset Center workflow.

## Advance the shared workflow

1. Call `create_character_workflow` once with a stable `clientRequestId` and the current host client.
2. Call `attach_character_source` with the returned `workflowId` and `version`.
3. Return the `workbenchUrl`; the browser and native chat now refer to the same opaque workflow ID.
4. Route the T-Pose step from the current host's capabilities, regardless of `workflow.origin`. A workflow created by Claude may later continue in Codex, and vice versa.
5. When the current host is Codex Desktop with native image understanding and imagegen:
   - Understand and summarize the selected source in Codex. Do not call backend `analyze-image` or `generate-tpose` on this Codex-native branch.
   - Describe the exact T-Pose operation and wait for explicit approval.
   - Call `materialize_character_source`, then invoke native imagegen exactly once with that local reference for the approved attempt.
   - Review the one result in Codex, prepare `analysis` and `qualityReport`, and call `attach_character_tpose` exactly once. Generate and import exactly one candidate per approved attempt.
   - Show the imported preview and report from the refreshed workflow. Advisory warnings are shown without automatic regeneration. Wait for acceptance or an explicit request for one more version.
   - Older candidates remain workflow history; the latest imported candidate becomes active.
6. In Claude Code, or any current host without native imagegen, retain the existing backend path: automatically start `analyze-image` after source attachment, wait and report it, then require explicit approval before starting backend `generate-tpose`.
7. Explicit confirmation remains required for `generate-model` and candidate selection. Summarize the exact provider and operation before generation and wait for the user's approval. For Meshy, the exact operation is `Meshy-T2 Image-to-3D → static GLB`; for Tripo, keep the existing Tripo operation.
   - Tripo: continue through the shared Character Workbench `generate-model`, `rig-check`, `rig`, and `retarget` stages; each stage uses Tripo.
   - Meshy: use the same shared Character Workbench commands after the approved T-Pose. The backend selects Meshy-T2 for `generate-model`, Meshy local preflight plus Meshy rigging for `rig-check`/`rig`, and Meshy's animation library/API for `retarget`. Never mix providers inside one workflow.
   - When a refreshed result contains top-level `previewUrl`, include it in the completion report as `[直接预览模型](<previewUrl>)`. This stable anonymous page opens the GLB itself rather than the Workbench canvas.
   - Use the stable top-level `previewUrl`, not an artifact's expiring signed `previewUrl` or `downloadUrl`.
   - Every time the completion report names a ready GLB file, use its entry from `deliveries` and include all four: `文件：<fileName>`, `[直接预览模型](<previewUrl>)` (or `[直接预览动作模型](<previewUrl>)` for an action), a Markdown download link from `downloadUrl`, and `[画布中预览模型](<workbenchUrl>)`.
   - Download URLs are refreshed signed links. If a named ready GLB has no `downloadUrl`, call `get_character_workflow` once to refresh it. If it is still absent, say `下载链接暂不可用` next to that file; never silently omit the download line.
8. Reload with `get_character_workflow` immediately before any later mutation for either provider because the user may have acted in the browser Inspector. The workflow snapshot is the source of truth for stage, active artifacts, provider task IDs, and signed delivery links.
9. Use `confirm_character_output` only after the user names a T-Pose or static-model candidate, or the browser already marks that choice active. After the user confirms the final static model, pass `nextCommand: rig-check`; a successful Rig Check may continue into `rig` through the existing orchestrator without another prompt.
10. When the validated sole active rigged output is ready, confirm it and present action selection without another binding confirmation.
11. Use `select_character_actions` only after the user explicitly chooses the action list. Automatically start `retarget` with the returned latest version, call `wait_character_workflow`, and report the results without another start confirmation.
   - When Retarget finishes successfully, the top-level `previewUrl` points to the first selected successful action and opens directly in the anonymous animated model viewer. Report it as `[直接预览动作模型](<previewUrl>)` and also include `[画布中预览模型](<workbenchUrl>)`.
   - `actionPreviewUrls` contains each successful selected action's file name, stable direct viewer link, and refreshed download link. Include a download link for every successful action named in the report.
12. Report production as complete once the ready base GLB and every successful selected action GLB have been named with their preview and download links. Preserve the `workflowId` for a possible later handoff, then stop. Do not suggest, ask for, or start an Asset Center upload as an automatic next step.

For Meshy workflows, report the same Asset Center deliveries as Tripo and include Meshy task IDs or `consumed_credits` when they are present in artifact metadata. Do not echo the API key. Do not start an Asset Center library upload unless the user separately asks for that explicit handoff.

## Version conflicts

Every write uses `expectedVersion`. If a tool returns `stale_version`, inspect `latest`:

- If the browser already performed the requested action, acknowledge it and continue from the new version.
- Otherwise explain that the workflow changed elsewhere and ask once before sending the write again.
- Never automatically replay a paid stage or confirmation.

## Quick reference

| Intent | Tool |
|---|---|
| Create the formal draft after source selection | `create_character_workflow` |
| Upload only the chosen reference | `attach_character_source` |
| Cache the active source for Codex-native imagegen | `materialize_character_source` |
| Import one Codex-native T-Pose and its report | `attach_character_tpose` |
| Refresh browser/native shared state | `get_character_workflow` |
| Wait for provider completion | `wait_character_workflow` |
| Start an explicitly approved or prerequisite-authorized stage | `start_character_stage` |
| Select and confirm a generated output | `confirm_character_output` |
| Choose up to the workflow action limit | `select_character_actions` |

## Common mistakes

- Creating a draft for every concept pollutes workflow history; wait for selection.
- Treating the browser as a second workflow creates divergence; always use the returned `workflowId`.
- Calling backend `analyze-image` or `generate-tpose` from the Codex-native branch bypasses the host-capability route.
- Starting `generate-tpose` or `generate-model` from inferred intent, or starting an automatic stage before its documented prerequisite, violates the confirmation boundary.
- Regenerating automatically because of advisory quality warnings spends another attempt without approval; show the warning and wait.
- Retrying 409 automatically can duplicate a user's browser action.
- Sending sharks or quadrupeds into the biped path produces invalid T-Poses and rigs; stop at the capability boundary.
- Continuing into Asset Center upload from this skill crosses the production boundary; stop after the GLB deliveries and wait for a later explicit upload request routed to `asset-center-library`.
- Adding a chat surface inside Asset Center duplicates the native host; the browser remains canvas plus Inspector only.
