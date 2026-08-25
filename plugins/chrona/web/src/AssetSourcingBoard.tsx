import "./styles.css";

import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";

import {
  callTool,
  currentDisplayMode,
  publishConfirmedPlan,
  requestAssetCatalogRefresh,
  requestDisplayMode,
  restoredWidgetState,
  saveWidgetState,
  subscribeToolOutput,
} from "./bridge";
import type { DisplayMode } from "./bridge";

type Asset = {
  id: string;
  displayName: string;
  parentAssetId?: string;
  previewUrl?: string;
  compatibility?: { status?: string };
};

type Proposal = any;
type ChoiceState = { slots: Record<string, { model: any; actions: Record<string, any> }> };
type ChoiceRow = {
  key: string;
  value: string;
  candidate: string;
  modelSource: string;
  action: string;
  scene: string;
  actionSource: string;
  reuseStatus: string;
  previewUrl?: string;
  recommended?: boolean;
  disabled?: boolean;
  conditional?: boolean;
};

function modelAssets(slot: any): Asset[] {
  return [slot.model.recommended, ...(slot.model.alternatives ?? [])].filter(Boolean);
}

function modelValue(choice: any) {
  return choice?.assetId ? `${choice.source}:${choice.assetId}` : choice?.source;
}

function parseChoiceValue(value: string) {
  const [source, assetId] = value.split(":", 2);
  return assetId ? { source, assetId } : { source };
}

function safePreviewUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function entityLabel(slot: any) {
  const raw = String(slot.entityLabel ?? slot.name ?? slot.id ?? "资产").trim();
  const concise = raw.split(/[，,；;。:：\n]/, 1)[0].trim() || raw;
  const characters = Array.from(concise);
  return characters.length <= 16 ? concise : `${characters.slice(0, 15).join("")}…`;
}

function optionLabel(index: number) {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

function FormattedText({ value }: { value: string }) {
  return <>{value.split(/(`[^`]+`)/g).filter(Boolean).map((part, index) =>
    part.startsWith("`") && part.endsWith("`")
      ? <code key={index}>{part.slice(1, -1)}</code>
      : <span key={index}>{part}</span>,
  )}</>;
}

function preferredModel(slot: any) {
  if (slot.model.confidence === "high" && slot.model.defaultSource === "reuse_project" && slot.model.projectCandidates?.[0]) {
    return { source: "reuse_project", assetId: slot.model.projectCandidates[0].id };
  }
  if (slot.model.confidence === "high" && slot.model.recommended) {
    return { source: "reuse_asset_center", assetId: slot.model.recommended.id };
  }
  return { source: "generate_new" };
}

function defaultActionChoice(action: any, model: any) {
  if (action.defaultSource === "reuse_linked_action") {
    const linked = action.candidates?.find((entry: Asset) => entry.parentAssetId === model.assetId);
    if (linked) return { source: "reuse_linked_action", assetId: linked.id };
  }
  if (action.defaultSource === "reuse_compatible_action") {
    const compatible = action.candidates?.find((entry: Asset) => entry.compatibility?.status === "verified");
    const reused = model.source === "reuse_asset_center" || model.source === "reuse_project";
    if (compatible && reused) return { source: "reuse_compatible_action", assetId: compatible.id };
  }
  if (action.defaultSource === "generate_action") {
    const reused = model.source === "reuse_asset_center" || model.source === "reuse_project";
    if (model.source === "generate_new" || (reused && action.generationRoute?.supportedForReusedBase)) {
      return { source: "generate_action" };
    }
  }
  if (action.defaultSource === "primitive_fallback") return { source: "primitive_fallback" };
  return { source: "runtime_procedural" };
}

function defaultState(proposal: Proposal): ChoiceState {
  const slots: ChoiceState["slots"] = {};
  for (const slot of proposal.slots) {
    const model = preferredModel(slot);
    slots[slot.id] = {
      model,
      actions: Object.fromEntries(slot.actions.map((action: any) => [action.name, defaultActionChoice(action, model)])),
    };
  }
  return { slots };
}

function modelScene(slot: any) {
  return slot.model.scene ?? slot.actions?.[0]?.scene ?? "模型首次进入场景时";
}

function generatedModelSource(slot: any) {
  return slot.model.generatedSource ?? `新生成${slot.model.generator ? ` · ${slot.model.generator}` : ""}`;
}

function modelRows(slot: any): ChoiceRow[] {
  const selectedDefault = modelValue(preferredModel(slot));
  const generated: ChoiceRow = {
    key: "generate_new",
    value: "generate_new",
    candidate: slot.model.generatedLabel ?? `生成原创${slot.name}`,
    modelSource: generatedModelSource(slot),
    action: "—",
    scene: modelScene(slot),
    actionSource: "—",
    reuseStatus: slot.model.generatedReuseStatus ?? (slot.tier === "key" ? "原创主模型" : "原创静态模型"),
  };
  const project = (slot.model.projectCandidates ?? []).map((entry: Asset) => ({
    key: `project:${entry.id}`,
    value: `reuse_project:${entry.id}`,
    candidate: `当前项目：${entry.displayName}`,
    modelSource: "当前项目模型",
    action: "—",
    scene: modelScene(slot),
    actionSource: "—",
    reuseStatus: "项目内复用",
    previewUrl: safePreviewUrl(entry.previewUrl),
  } satisfies ChoiceRow));
  const center = modelAssets(slot).map((entry) => ({
    key: `center:${entry.id}`,
    value: `reuse_asset_center:${entry.id}`,
    candidate: `复用素材: ${entry.displayName}(点击预览)`,
    modelSource: "Asset Center 静态 GLB",
    action: "—",
    scene: modelScene(slot),
    actionSource: "—",
    reuseStatus: "候选复用",
    previewUrl: safePreviewUrl(entry.previewUrl),
  } satisfies ChoiceRow));
  const fallback: ChoiceRow = {
    key: "primitive_fallback",
    value: "primitive_fallback",
    candidate: "使用three.js程序生成",
    modelSource: "程序模型",
    action: "—",
    scene: modelScene(slot),
    actionSource: "—",
    reuseStatus: "—",
  };

  const reuse = [...project, ...center];
  const preferredReuse = reuse.find((row) => row.value === selectedDefault);
  const ordered = preferredReuse
    ? [preferredReuse, generated, ...reuse.filter((row) => row !== preferredReuse), fallback]
    : [generated, ...reuse, fallback];
  return ordered.map((row) => ({ ...row, recommended: row.value === selectedDefault }));
}

function assetSubject(slot: any) {
  return slot.assetKind === "character" || slot.assetKind === "creature" ? "人物/主体" : "道具";
}

function actionRequirement(slot: any, action: any) {
  if (assetSubject(slot) === "道具") return "道具动作";
  if (action.requirement) return action.requirement;
  const name = String(action.name).toLowerCase();
  if (name === "idle") return "待机动作";
  if (name.includes("patrol")) return "巡逻动作";
  if (name.includes("hover") || name.includes("glow")) return "展示动作";
  if (name === "walk" || name === "move" || name === "run") return "移动动作";
  return `${action.name}动作`;
}

function runtimeCandidate(action: any) {
  if (action.runtimeLabel) return action.runtimeLabel;
  const name = String(action.name).toLowerCase();
  if (name === "idle") return "呼吸、重心摇摆、轻微起伏";
  return "运行时整体移动与轻微摆动";
}

function staticModelSourceForAction(slot: any, selectedModel: any) {
  const subject = assetSubject(slot);
  if (selectedModel.source === "reuse_asset_center") return `Asset Center 已有${subject}静态 GLB`;
  if (selectedModel.source === "reuse_project") return `当前项目已有${subject}静态 GLB`;
  if (selectedModel.source === "generate_new") return `新生成${subject}静态 GLB`;
  return "Three.js 程序模型";
}

function generatedActionLabel(slot: any, action: any, selectedModel: any) {
  const name = `\`${action.name}\``;
  if (selectedModel.source === "reuse_asset_center") {
    return `Asset Center 静态 GLB → Tripo 新生成 ${name} 动作 GLB`;
  }
  if (selectedModel.source === "reuse_project") {
    return `当前项目静态 GLB → Tripo 新生成 ${name} 动作 GLB`;
  }
  return `新生成${assetSubject(slot)}静态 GLB → 新生成 ${name} 动作 GLB`;
}

function generatedActionSource(selectedModel: any) {
  if (selectedModel.source === "reuse_asset_center") return "Tripo 重定向 · Asset Center 静态 GLB → 新动作 GLB";
  if (selectedModel.source === "reuse_project") return "Tripo 重定向 · 当前项目静态 GLB → 新动作 GLB";
  return "Tripo 重定向 · 新静态 GLB → 新动作 GLB";
}

function generatedActionReuseStatus(slot: any, selectedModel: any) {
  const subject = assetSubject(slot);
  if (selectedModel.source === "reuse_asset_center" || selectedModel.source === "reuse_project") {
    return `复用${subject}静态 GLB，新生成动作 GLB`;
  }
  return `新${subject}与新动作成套生成`;
}

function actionRows(slot: any, action: any, selectedModel: any): ChoiceRow[] {
  const currentDefault = defaultActionChoice(action, selectedModel);
  const defaultValue = modelValue(currentDefault);
  const reusedBase = selectedModel.source === "reuse_asset_center" || selectedModel.source === "reuse_project";
  const canGenerateAction = selectedModel.source === "generate_new"
    || (reusedBase && action.generationRoute?.supportedForReusedBase);
  const rows: ChoiceRow[] = [];

  if (action.generator && action.preset) {
    rows.push({
      key: "generate_action",
      value: "generate_action",
      candidate: generatedActionLabel(slot, action, selectedModel),
      modelSource: staticModelSourceForAction(slot, selectedModel),
      action: action.name,
      scene: action.scene,
      actionSource: `${generatedActionSource(selectedModel)} · \`${action.preset}\``,
      reuseStatus: generatedActionReuseStatus(slot, selectedModel),
      disabled: !canGenerateAction,
    });
  }

  for (const entry of action.candidates ?? []) {
    const hasParent = Boolean(entry.parentAssetId);
    const linked = Boolean(hasParent && entry.parentAssetId === selectedModel.assetId);
    const compatible = entry.compatibility?.status === "verified";
    const source = hasParent ? "reuse_linked_action" : "reuse_compatible_action";
    rows.push({
      key: `${source}:${entry.id}`,
      value: `${source}:${entry.id}`,
      candidate: `复用素材: ${entry.displayName}(点击预览)`,
      modelSource: `Asset Center 已有${assetSubject(slot)}动作GLB`,
      action: action.name,
      scene: action.scene,
      actionSource: hasParent ? "Asset Center 已有动作 GLB · 游戏直接复用" : "Asset Center 已有动作 GLB · 验证兼容后复用",
      reuseStatus: hasParent ? `\`parentAssetId\` 与${assetSubject(slot)}静态 GLB 匹配` : "骨骼兼容关系必须验证",
      previewUrl: safePreviewUrl(entry.previewUrl),
      disabled: hasParent ? !linked : !(reusedBase && compatible),
      conditional: true,
    });
  }

  rows.push({
    key: "runtime_procedural",
    value: "runtime_procedural",
    candidate: runtimeCandidate(action),
    modelSource: staticModelSourceForAction(slot, selectedModel),
    action: action.name,
    scene: action.scene,
    actionSource: action.runtimeSource ?? "运行时程序动画（不生成动作 GLB）",
    reuseStatus: action.runtimeReuseStatus ?? (String(action.name).toLowerCase() === "walk" ? "无动作资产" : "无需独立 GLB"),
  });

  if (action.defaultSource === "primitive_fallback") {
    rows.push({
      key: "primitive_fallback",
      value: "primitive_fallback",
      candidate: "运行时动作兜底",
      modelSource: staticModelSourceForAction(slot, selectedModel),
      action: action.name,
      scene: action.scene,
      actionSource: "运行时程序动画",
      reuseStatus: "无动作资产",
    });
  }

  const preferred = rows.find((row) => row.value === defaultValue && !row.disabled);
  const ordered = preferred ? [preferred, ...rows.filter((row) => row !== preferred)] : rows;
  return ordered.map((row) => ({ ...row, recommended: row.value === defaultValue && !row.disabled }));
}

function RequirementRows({
  entity,
  requirement,
  rows,
  selectedValue,
  onSelect,
}: {
  entity: string;
  requirement: string;
  rows: ChoiceRow[];
  selectedValue: string;
  onSelect: (value: string) => void;
}) {
  return rows.map((row, index) => {
    const selected = row.value === selectedValue;
    return (
      <tr data-selected={selected || undefined} data-disabled={row.disabled || undefined} key={row.key}>
        <th className="entity-cell" scope="row">{index === 0 ? <span className="entity-label">{entity}</span> : "〃"}</th>
        <td>{requirement}</td>
        <td className="option-cell">{optionLabel(index)}</td>
        <td className="selection-cell">
          <label>
            <input
              type="checkbox"
              checked={selected}
              disabled={row.disabled}
              onChange={() => onSelect(row.value)}
              aria-label={`选择${entity} ${requirement} ${optionLabel(index)}`}
            />
            <span>{selected ? (row.recommended ? "推荐" : "已选择") : row.conditional ? "条件可选" : ""}</span>
          </label>
        </td>
        <td className="candidate-cell">
          {row.previewUrl ? (
            <a
              href={row.previewUrl}
              target="_blank"
              rel="noreferrer"
            >
              <FormattedText value={row.candidate} /><span aria-hidden="true">↗</span>
            </a>
          ) : <FormattedText value={row.candidate} />}
        </td>
        <td>{row.modelSource}</td>
        <td>{row.action === "—" ? "—" : <code>{row.action}</code>}</td>
        <td>{row.scene}</td>
        <td><FormattedText value={row.actionSource} /></td>
        <td><FormattedText value={row.reuseStatus} /></td>
      </tr>
    );
  });
}

export function AssetSourcingBoard() {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [choices, setChoices] = useState<ChoiceState | null>(null);
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => currentDisplayMode());
  const [displayError, setDisplayError] = useState("");

  useEffect(() => subscribeToolOutput((output) => {
    const next = output?.proposal ?? output;
    if (next?.schema !== "shark-asset-sourcing-proposal") return;
    const restored = restoredWidgetState();
    setProposal(next);
    setChoices(restored?.runId === next.runId && restored?.choices ? restored.choices : defaultState(next));
  }), []);

  useEffect(() => {
    if (proposal && choices) saveWidgetState({ runId: proposal.runId, choices });
  }, [proposal, choices]);

  if (!proposal || !choices) return <div className="loading">等待资产方案…</div>;

  const updateModel = (slot: any, value: string) => {
    const model = parseChoiceValue(value);
    setChoices((current) => {
      const next = structuredClone(current!);
      next.slots[slot.id].model = model;
      next.slots[slot.id].actions = Object.fromEntries(
        slot.actions.map((action: any) => [action.name, defaultActionChoice(action, model)]),
      );
      return next;
    });
  };

  const updateAction = (slotId: string, actionName: string, value: string) => {
    setChoices((current) => {
      const next = structuredClone(current!);
      next.slots[slotId].actions[actionName] = parseChoiceValue(value);
      return next;
    });
  };

  const confirm = async () => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await callTool("confirm_asset_sourcing_plan", { proposal, uiState: choices });
      const plan = result?.structuredContent ?? result?.structured_content ?? result;
      if (plan?.schema !== "shark-asset-sourcing-plan") throw new Error("确认工具未返回有效方案");
      publishConfirmedPlan(plan);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPending(false);
    }
  };

  const toggleFullscreen = async () => {
    const requestedMode: DisplayMode = displayMode === "fullscreen" ? "inline" : "fullscreen";
    setDisplayError("");
    try {
      const grantedMode = await requestDisplayMode(requestedMode);
      setDisplayMode(grantedMode);
      if (grantedMode !== requestedMode) setDisplayError(`宿主仅授予 ${grantedMode} 显示模式`);
    } catch {
      setDisplayError("当前宿主不支持切换全屏显示");
    }
  };

  const refreshAssets = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setDisplayError("");
    try {
      await requestAssetCatalogRefresh();
      window.setTimeout(() => setRefreshing(false), 1200);
    } catch {
      setRefreshing(false);
      setDisplayError("无法请求刷新 Asset Center，请稍后重试");
    }
  };

  return (
    <main className="sourcing-shell" data-display-mode={displayMode}>
      <header className="board-header">
        <h1>完整资产确认表</h1>
        <div className="header-actions">
          <button
            className="refresh-button"
            type="button"
            disabled={refreshing}
            onClick={() => void refreshAssets()}
          >
            {refreshing ? "正在刷新…" : "刷新资产"}
          </button>
          <button
            className="display-mode-button"
            type="button"
            aria-pressed={displayMode === "fullscreen"}
            onClick={() => void toggleFullscreen()}
          >
            {displayMode === "fullscreen" ? "退出全屏" : "全屏查看"}
          </button>
        </div>
      </header>
      {error ? <div className="error-banner">{error}</div> : null}
      {displayError ? <div className="display-error" role="status">{displayError}</div> : null}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>角色/实体</th>
              <th>资产需求</th>
              <th>选项</th>
              <th>当前选择</th>
              <th>候选方案（点击预览）</th>
              <th>模型来源</th>
              <th>动作</th>
              <th>触发场景</th>
              <th>动作来源</th>
              <th>复用状态</th>
            </tr>
          </thead>
          <tbody>
            {proposal.slots.flatMap((slot: any) => {
              const selected = choices.slots[slot.id];
              if (!selected) return [];
              return [
                <RequirementRows
                  key={`${slot.id}:model`}
                  entity={entityLabel(slot)}
                  requirement={assetSubject(slot)}
                  rows={modelRows(slot)}
                  selectedValue={modelValue(selected.model)}
                  onSelect={(value) => updateModel(slot, value)}
                />,
                ...slot.actions.map((action: any) => (
                  <RequirementRows
                    key={`${slot.id}:${action.name}`}
                    entity={entityLabel(slot)}
                    requirement={actionRequirement(slot, action)}
                    rows={actionRows(slot, action, selected.model)}
                    selectedValue={modelValue(selected.actions[action.name])}
                    onSelect={(value) => updateAction(slot.id, action.name, value)}
                  />
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
      <footer>
        <button className="confirm-button" type="button" disabled={pending} onClick={() => void confirm()}>
          {pending ? "正在确认…" : "确认资产方案并开始制作"}
        </button>
      </footer>
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<AssetSourcingBoard />);
