# Meshy-T2 provider route

Use this reference after the user explicitly selects Meshy and supplies a Meshy API key to `create_character_workflow`. The shared Asset Center backend is the normal route; the standalone script is only a fallback for work outside a shared workflow.

## Stage mapping

| Workflow stage | Meshy operation | Output |
| --- | --- | --- |
| Image-to-Model | `POST /openapi/v1/image-to-3d` with `model_type: smart-topology`, `ai_model: meshy-t2` | Textured static GLB |
| Rig Check | Local GLB preflight: valid GLB, mesh, texture/material, face-count guard | Pass/fail report; no Meshy credits |
| Rigging | `POST /openapi/v1/rigging` using the completed Image-to-3D `input_task_id` | Rigged GLB and Meshy rig task ID |
| Action retarget | `POST /openapi/v1/animations` with the rig task ID and one `action_id` | One action GLB per selected action |

Meshy rigging is intended for textured humanoids and rejects unclear/non-humanoid meshes. The API documents a 300,000-face limit for task-based rigging. The local preflight is an eligibility guard, not a replacement for Meshy's pose estimation.

## Credentials and safety

- Ask the user to provide the key. The backend encrypts it in the workflow record and strips it from public snapshots; do not store it in source code, shell history, logs, or generated reports.
- Never echo the full key. Error messages must be redacted before being shown to the user.
- Meshy result URLs are signed and short-lived. Download them immediately and report local files, not the signed URL as a permanent asset link.
- Generation, rigging, and animation consume the user's Meshy credits. Ask for confirmation immediately before each paid boundary unless the user has already explicitly authorized that complete Meshy pipeline.

## Action selection

Resolve human-readable action names through `GET /openapi/v1/animations/library` rather than hardcoding IDs. For example, resolve `run` in the `WalkAndRun` category, then pass the returned numeric `action_id` to the animation task. Prefer one animation request per output GLB so the workflow can name and preview each action separately.

The current Meshy API may also return walking/running basic animation GLBs from the rigging task. Treat those as optional convenience outputs; use the Animation API for the selected action list so the workflow remains explicit and repeatable.

Reference: [Meshy Image to 3D API](https://docs.meshy.ai/en/api/image-to-3d), [Meshy Rigging API](https://docs.meshy.ai/en/api/rigging), [Meshy Animation API](https://docs.meshy.ai/en/api/animation).
