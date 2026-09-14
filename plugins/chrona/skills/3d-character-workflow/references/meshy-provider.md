# Meshy-T2 provider route

Use this reference after the user explicitly selects Meshy and supplies a Meshy API key to `create_character_workflow`. The shared Asset Center backend is the normal route; the standalone script is only a fallback for work outside a shared workflow.

## Stage mapping

| Workflow stage | Meshy operation | Output |
| --- | --- | --- |
| Image-to-Model | `POST /openapi/v1/image-to-3d` with `model_type: smart-topology`, `ai_model: meshy-t2`, `pose_mode: t-pose`, and `target_formats: ["glb"]` | Textured static GLB with Meshy-managed T-Pose output |
| Rig Check | Reuse the active immutable GLB's stored validation; read/validate only if missing or outdated | Pass/fail report; no Meshy credits |
| Rigging | `POST /openapi/v1/rigging` using the completed Image-to-3D `input_task_id` | Rigged GLB and Meshy rig task ID |
| Action retarget | `POST /openapi/v1/animations` with the rig task ID and one `action_id` | One action GLB per selected action |

Meshy rigging is intended for textured humanoids and rejects unclear/non-humanoid meshes. The API documents a 300,000-face limit for task-based rigging. The local preflight is an eligibility guard, not a replacement for Meshy's pose estimation.

Meshy owns the pose conversion on the Image-to-3D request through `pose_mode: "t-pose"`. Do not spend a separate Codex/native image-generation attempt creating an external T-Pose image before calling Meshy.

## Configure the local API key

按下面步骤操作。只有第 1 步的隐藏提示需要输入 Key；代码里的其他文字都不要改。完成后重新打开终端或 Codex。

macOS：

1. 打开“终端”，复制并运行：

```sh
security add-generic-password -U -a "$USER" -s meshy -w
```

2. 看到 `password:` 时，粘贴你的 Meshy API Key 并按回车；随后再次输入并按回车。

3. 再复制运行下面两行（不要修改）：

```sh
printf '%s\n' 'export MESHY_API_KEY="$(security find-generic-password -a "$USER" -s meshy -w)"' >> ~/.zshrc
source ~/.zshrc
```

Key 会保存在 macOS 的钥匙串中，之后自动设置为 `MESHY_API_KEY`。不要把 Key 写进命令、文件或聊天消息。

Windows PowerShell（长期有效）：

```powershell
$k = [Net.NetworkCredential]::new("", (Read-Host "Meshy Key" -AsSecureString)).Password; [Environment]::SetEnvironmentVariable("MESHY_API_KEY", $k, "User"); $env:MESHY_API_KEY = $k; Remove-Variable k
```

看到隐藏提示时粘贴 Key 并按回车；然后重新打开终端或 Codex。共享 Character Workbench 和备用脚本都会读取 `MESHY_API_KEY`。

## Credentials and safety

- Ask the user to provide the key. The backend encrypts it in the workflow record and strips it from public snapshots; do not store it in source code, shell history, logs, or generated reports.
- Never echo the full key. Error messages must be redacted before being shown to the user.
- In the shared workflow, the backend downloads and stores provider results once. Use its stable previews and refreshed download links; do not redownload GLBs for agent-side checks. Only the standalone fallback must download provider results before their signed links expire.
- Disclose credit use in the initial provider-choice prompt. That choice authorizes one automatic Meshy T-Pose-capable Image-to-3D → static GLB → local Rig Check → Meshy rigging attempt once the key is available; do not repeat T-Pose/model/rigging confirmation prompts. Pause for action selection, which authorizes those animation requests. A failure, paid retry, regeneration, or provider switch requires a new user decision.

## Action selection

The backend fetches `GET /openapi/v1/animations/library` once per selected action batch, resolves names, and passes the returned numeric `action_id` to each animation task. The agent uses the workflow's action catalog and does not make a duplicate library request. Keep one animation request per output GLB; unsupported mappings stop with a concrete error rather than a silently substituted action.

The current Meshy API may also return walking/running basic animation GLBs from the rigging task. Treat those as optional convenience outputs; use the Animation API for the selected action list so the workflow remains explicit and repeatable.

Reference: [Meshy Image to 3D API](https://docs.meshy.ai/en/api/image-to-3d), [Meshy Rigging API](https://docs.meshy.ai/en/api/rigging), [Meshy Animation API](https://docs.meshy.ai/en/api/animation).
