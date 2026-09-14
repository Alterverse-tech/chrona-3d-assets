---
name: 3d-character-workflow
description: Use when a user asks Codex Desktop or Claude Code to create a human-biped character through reference selection, provider-specific T-Pose/GLB generation, rigging, and action GLBs with Meshy-T2 or Tripo, or to continue that production workflow. Only the Meshy-T2 provider route can produce the T-Pose directly during Image-to-3D. Stop when the generated files are complete; Asset Center upload belongs to asset-center-library.
---

# 3D Character Workflow

## Overview

Own only the human-biped production side: `reference → provider-specific T-Pose/Image-to-Model → static GLB → Rig Check → rig → actions`. When `provider = Meshy`, Image-to-3D outputs the T-Pose directly; when `provider = Tripo`, retain the separate T-Pose route. Keep the conversation and temporary concepts in the native agent host, use the shared Character Workbench after the user selects one supported reference, and stop when the generated static, rigged, and selected action GLBs are complete.

This skill never uploads completed GLBs to the Asset Center library. If the user later explicitly asks to upload them, hand the existing `workflowId` to `asset-center-library`; do not perform the upload from this skill.

## Authentication

This skill uses the same plugin-wide Chrona sign-in as `asset-center-library`; there is nothing to configure. The first authenticated Character Workbench call opens Asset Center's authorization page in the user's browser (Google or email code) as the single `Chrona` OAuth client, and the cached tokens stay on the user's machine and serve both skills. If a request reports pending authorization, tell the user to finish the page that just opened; when no browser appeared, give them the authorization link printed on stderr. Never ask the user to paste a Service Token or any token into chat or source code — `ASSET_CENTER_SERVICE_TOKEN` is only an optional environment override for CI or shared runners.

## Best-effort update check

This loaded Chrona plugin bundle is version `0.1.7`. On the first use of this skill in each new task, make one non-blocking update check for the current host only:

- Give the shell call a five-second timeout. In Codex, refresh `chrona-3d-assets` with `codex plugin marketplace upgrade chrona-3d-assets --json`; in Claude Code, use `claude plugin marketplace update chrona-3d-assets`.
- Read the configured marketplace root from that host's JSON marketplace list, then read the `chrona` version from `.agents/plugins/marketplace.json` for Codex or `.claude-plugin/marketplace.json` for Claude Code.
- Only when the refreshed manifest contains a valid semantic version greater than `0.1.7`, append one short, non-blocking notice that names the available version and asks the user to say `更新插件`. Continue the character request without waiting.
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

- If the request clearly identifies one reference, use it as the selected source without a separate reference-confirmation question. Ask only when the intended subject or choice between multiple images is unclear.
- If the user asks for visual changes, create temporary variants and wait for a choice.
- If image generation is unavailable, ask for a local reference image. Never fabricate a file path.

Temporary candidates are not workflow artifacts. Do not call `create_character_workflow` before a choice. Upload only the selected image with `attach_character_source`.

## Choose the 3D provider before generation

Before creating the workflow, ask the user to choose exactly one provider and keep that provider for every later 3D stage. Explain in this same prompt that choosing a provider starts one automatic T-Pose → static GLB → Rig Check → rigging attempt, that generation/rigging may consume credits, and that the next normal pause is action selection:

1. `Meshy (Meshy-T2)` — the user must provide their own Meshy API key when the workflow is created. Before asking for it, show the persistent copy-paste setup commands in [references/meshy-provider.md](references/meshy-provider.md) for macOS and Windows PowerShell; both commands read the key through a hidden local prompt and configure `MESHY_API_KEY` for future sessions. Meshy Image-to-3D must receive `model_type: "smart-topology"`, `ai_model: "meshy-t2"`, and `pose_mode: "t-pose"`; this route creates the T-Pose-capable static model directly, so do not require Codex/native imagegen or a separate external T-Pose image. The backend encrypts the key at rest and never returns it in workflow snapshots. For the standalone fallback script, use `MESHY_API_KEY`; never put the key in command-line arguments, shell history, this skill, source files, logs, or the final response.
2. `Tripo` — use the existing Asset Center/Tripo route and its configured key pool.

The provider choice is sticky for the workflow. Do not generate the static model with Meshy and then silently send it to Tripo for rigging or animation, or the reverse. If the user has not chosen a provider, stop before any paid 3D request and ask the one focused choice question.

After that choice and any required Meshy key input, proceed without asking to approve the T-Pose plan, accept the T-Pose, generate the static model, accept the static model, or continue rigging. These stages are covered by the disclosed automatic-pipeline choice. Keep short progress updates and previews non-blocking. If the user explicitly requests step-by-step review or a narrower output, honor that instead.

Automatically accept usable active outputs; do not claim the user visually approved them. Advisory warnings do not add a confirmation step. Stop on a failed quality gate, missing/invalid output, provider error, insufficient credits, or unresolved source ambiguity. Explain the concrete problem and ask before a paid retry, regeneration, or provider switch; the initial choice does not authorize unlimited attempts.

When Meshy is selected, read [references/meshy-provider.md](references/meshy-provider.md) for the endpoint mapping. The shared backend owns provider calls, action-library matching, task IDs, previews, and credit metadata. Meshy `rig-check` reuses the active model's stored validation; only a missing/outdated summary needs local GLB preflight. Meshy rigging then performs provider-side pose/rig validation. Do not separately query Meshy from the agent. Use the standalone script only as a fallback outside the shared workflow.

## Keep the normal path lean

- Reuse the snapshot/version returned by create, attach, confirm, select, start, or wait for the next step. Do not follow it with another GET, raw API snapshot, or provider-status query just to verify the same result. Refresh after user interaction, resuming a task, a stale-version conflict, or an expired delivery link.
- Trust the backend's one validation per new GLB. Do not download files again for hash, header, bone, or animation-track inspection; do not run browser checks unless explicitly requested. Keep authentication, ownership, version checks, and paid-task deduplication intact.
- Read the T-Pose once for identity, full-body visibility, and usable pose. Populate the required boolean fields honestly from that same quick review; omit the optional score and avoid a separate scoring/review round. Keep notes/issues brief, empty when there is nothing actionable.
- Use short phase updates, not repeated reports or link bundles. Backend traces already retain tasks, errors, artifacts, and credits; write a separate test log only when requested. Deliver preview/download links together at the end.

## Advance the shared workflow

1. Call `create_character_workflow` once with a stable `clientRequestId`, the current host client, and the selected `provider`. For Meshy, omit `meshyApiKey` when the host process has `MESHY_API_KEY` configured; the client reads that local variable and sends it through the protected backend request. Use the explicit `meshyApiKey` field only when the host provides a secure secret-input path; never ask the user to paste a key into chat.
2. Call `attach_character_source` with the returned `workflowId` and `version`.
3. Return the `workbenchUrl`; the browser and native chat now refer to the same opaque workflow ID.
4. Route the T-Pose step by provider before checking host capabilities, regardless of `workflow.origin`. A workflow created by Claude may later continue in Codex, and vice versa.
5. When Meshy is selected:
   - Do not call native imagegen, `materialize_character_source`, `analyze-image`, `generate-tpose`, or `attach_character_tpose` to create an external T-Pose image.
   - Start Meshy Image-to-3D from the attached reference with `model_type: "smart-topology"`, `ai_model: "meshy-t2"`, `pose_mode: "t-pose"`, and the GLB target format. Treat the returned static GLB as the Meshy T-Pose output and continue directly to backend validation, `rig-check`, and rigging.
   - Do not call `confirm_character_output(stage: tpose)` for a separate image artifact; the Meshy Image-to-3D result is the first generated model output.
6. When the current host is Codex Desktop with native image understanding and imagegen, and Tripo is selected:
   - Understand and summarize the selected source in Codex. Do not call backend `analyze-image` or `generate-tpose` on this Codex-native branch.
   - Briefly describe the T-Pose conversion and continue without a confirmation question. Preserve identity and clothing, remove background/handheld distractions, and conservatively complete cropped body regions for a full-body front T-Pose; disclose these defaults in the progress update.
   - Call `materialize_character_source`, then invoke native imagegen exactly once with that local reference for the authorized pipeline attempt.
   - Perform the quick review above, then call `attach_character_tpose` once with `analysis` and the compact `qualityReport`. Generate and import exactly one candidate per attempt; do not mark a failed check as passed to keep moving.
   - Continue from the returned usable active candidate without another GET or acceptance prompt. Briefly mention actionable warnings; do not produce a long quality report or regenerate for advisory warnings alone.
   - Older candidates remain workflow history; the latest imported candidate becomes active.
7. In Claude Code, or any current host without native imagegen, and when Tripo is selected, retain the existing backend path: automatically start `analyze-image` after source attachment, wait and report it, then automatically start backend `generate-tpose` if analysis supports the human-biped route. Use the ready active candidate that passes the available quality checks; if no active choice exists, choose the latest passing candidate. Do not ask for routine candidate acceptance.
8. With a usable Tripo T-Pose, automatically call `confirm_character_output(stage: tpose, nextCommand: generate-model)` using the returned version. Omit `artifactId` when the intended candidate is already active, avoiding an unnecessary selection write. Briefly report the provider and operation without a confirmation question. For Meshy, start `generate-model` directly from the attached reference using the Meshy `pose_mode: "t-pose"` request; do not create or confirm a separate T-Pose image artifact.
   - Tripo: continue through the shared Character Workbench `generate-model`, `rig-check`, `rig`, and `retarget` stages; each stage uses Tripo.
   - Meshy: after direct Meshy Image-to-3D returns the active static GLB, continue with the shared Character Workbench `rig-check`, `rig`, and `retarget` commands. The backend selects Meshy-T2 for `generate-model`, Meshy local preflight plus Meshy rigging for `rig-check`/`rig`, and Meshy's animation library/API for `retarget`. Never mix providers inside one workflow.
9. Use `wait_character_workflow` only while a stage is running, with `afterVersion` from the latest tool result. Its returned snapshot is sufficient to advance; do not add GET → wait → GET around each poll. Every mutation still carries `expectedVersion`; conflicts follow the rule below without automatic replay.
10. When the active static GLB is ready and its backend validation has no blocking failure, automatically call `confirm_character_output(stage: model_generation, nextCommand: rig-check)`, omitting `artifactId` for the already active model. A successful Rig Check continues into `rig` through the orchestrator. Keep these backend confirmations and version checks; do not ask for model acceptance or separately inspect the same GLB.
11. When the validated active rigged output is ready, automatically confirm it with `confirm_character_output(stage: rigging)`, then pause for the user to choose or enter actions. Explain that this choice starts the selected actions and may consume credits. Do not ask for another binding confirmation or reuse a previous task's action choices.
12. Use `select_character_actions` only after the user explicitly chooses the action list. Automatically start `retarget` with the returned latest version, call `wait_character_workflow`, and report the results without another start confirmation.
13. Deliver once: use `deliveries` for ready static, rigged, and selected action files, with one compact row per file containing its name, stable `previewUrl`, and `downloadUrl`; include the shared `workbenchUrl` only once. The top-level `previewUrl` opens the first successful selected action. If download links are missing/expired, refresh once; if still absent, mark `下载链接暂不可用`. Do not fetch the files to validate the links. Preserve `workflowId`, then stop; do not suggest or start an Asset Center upload.

For Meshy, summarize actual `consumedCredits` from the returned artifacts. Task IDs are already in the snapshot/traces; expand them only for troubleshooting or a requested test report. Never echo the API key.

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
| Cache the active source for Tripo/native imagegen | `materialize_character_source` |
| Import one Tripo/native T-Pose and its report | `attach_character_tpose` |
| Refresh browser/native shared state | `get_character_workflow` |
| Wait for provider completion | `wait_character_workflow` |
| Start a stage covered by the pipeline or action choice | `start_character_stage` |
| Automatically confirm a validated pipeline output | `confirm_character_output` |
| Choose up to the workflow action limit | `select_character_actions` |

## Common mistakes

- Creating a draft for every concept pollutes workflow history; wait for selection.
- Treating the browser as a second workflow creates divergence; always use the returned `workflowId`.
- Forcing Meshy through Codex/native imagegen or a separate `generate-tpose` artifact wastes image-generation quota and breaks the provider route; pass Meshy's `pose_mode: "t-pose"` on Image-to-3D instead.
- Calling backend `analyze-image` or `generate-tpose` for Meshy is unnecessary; those steps remain only for the Tripo path.
- Asking again for T-Pose or static-model acceptance after the disclosed automatic-pipeline choice adds redundant gates. Confirm usable outputs through the existing tools and continue until action selection.
- Skipping required backend confirmation calls, quality checks, or provider/key selection is not automation; it breaks the workflow prerequisites.
- Regenerating automatically because of advisory quality warnings spends another attempt without approval; show the warning and continue with the usable output instead.
- Retrying 409 automatically can duplicate a user's browser action.
- Sending sharks or quadrupeds into the biped path produces invalid T-Poses and rigs; stop at the capability boundary.
- Continuing into Asset Center upload from this skill crosses the production boundary; stop after the GLB deliveries and wait for a later explicit upload request routed to `asset-center-library`.
- Adding a chat surface inside Asset Center duplicates the native host; the browser remains canvas plus Inspector only.
