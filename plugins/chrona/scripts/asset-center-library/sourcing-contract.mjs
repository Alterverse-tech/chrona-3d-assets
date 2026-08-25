const MODEL_SOURCES = new Set(["reuse_project", "reuse_asset_center", "generate_new", "primitive_fallback"]);
const ACTION_SOURCES = new Set(["reuse_linked_action", "reuse_compatible_action", "generate_action", "runtime_procedural", "primitive_fallback"]);
const CONFIDENCE = new Set(["high", "medium", "low", "missing"]);

export function buildSourcingProposal(args, catalog) {
  assertObject(args, "arguments");
  if (!Array.isArray(args.requirements) || args.requirements.length === 0) {
    throw new Error("requirements must be a non-empty array");
  }

  const entries = new Map(catalogEntries(catalog).map((entry) => [entry.id, entry]));
  const sourcingMode = args.requirements.some((requirement) => requirement?.slotId || requirement?.model || requirement?.actions);
  if (!sourcingMode) return buildLegacyManifest(args, entries);

  const runId = requireText(args.runId, "runId");
  const seenSlots = new Set();
  const slots = args.requirements.map((requirement, index) => {
    assertObject(requirement, `requirements[${index}]`);
    const slotId = requireText(requirement.slotId, `requirements[${index}].slotId`);
    const name = requireText(requirement.need, `${slotId}.need`);
    if (seenSlots.has(slotId)) throw new Error(`duplicate slotId: ${slotId}`);
    seenSlots.add(slotId);

    const modelInput = requirement.model ?? {};
    assertObject(modelInput, `${slotId}.model`);
    const defaultSource = requireEnum(modelInput.defaultSource, MODEL_SOURCES, `${slotId}.model.defaultSource`);
    const confidence = requireEnum(modelInput.confidence ?? "missing", CONFIDENCE, `${slotId}.model.confidence`);
    const recommended = resolveEntry(modelInput.recommendedAssetId, entries);
    const alternatives = resolveEntries(modelInput.alternativeAssetIds, entries);
    const requestedModelIds = requestedIds(modelInput.recommendedAssetId, modelInput.alternativeAssetIds);
    const resolvedModelIds = new Set([recommended, ...alternatives].filter(Boolean).map((entry) => entry.id));
    const model = {
      defaultSource,
      confidence,
      recommended,
      alternatives,
      projectCandidates: normalizeProjectCandidates(modelInput.projectCandidates),
      missingAssetIds: requestedModelIds.filter((assetId) => !resolvedModelIds.has(assetId)),
      ...(textOrUndefined(modelInput.reason) ? { reason: modelInput.reason.trim() } : {}),
      ...(textOrUndefined(modelInput.generator) ? { generator: modelInput.generator.trim() } : {}),
      ...(textOrUndefined(modelInput.scene) ? { scene: modelInput.scene.trim() } : {}),
      ...(textOrUndefined(modelInput.generatedLabel) ? { generatedLabel: modelInput.generatedLabel.trim() } : {}),
      ...(textOrUndefined(modelInput.generatedSource) ? { generatedSource: modelInput.generatedSource.trim() } : {}),
      ...(textOrUndefined(modelInput.generatedReuseStatus) ? { generatedReuseStatus: modelInput.generatedReuseStatus.trim() } : {}),
      ...(textOrUndefined(modelInput.fallbackLabel) ? { fallbackLabel: modelInput.fallbackLabel.trim() } : {}),
      ...(textOrUndefined(modelInput.fallbackReuseStatus) ? { fallbackReuseStatus: modelInput.fallbackReuseStatus.trim() } : {}),
    };

    const seenActions = new Set();
    const actions = (requirement.actions ?? []).map((action, actionIndex) => {
      assertObject(action, `${slotId}.actions[${actionIndex}]`);
      const name = requireText(action.name, `${slotId}.actions[${actionIndex}].name`);
      if (seenActions.has(name)) throw new Error(`duplicate action name in ${slotId}: ${name}`);
      seenActions.add(name);
      const source = requireEnum(action.defaultSource, ACTION_SOURCES, `${slotId}.${name}.defaultSource`);
      const candidateIds = requestedIds(action.recommendedAssetId, action.alternativeAssetIds);
      const candidates = candidateIds.map((assetId) => resolveEntry(assetId, entries)).filter(Boolean);
      const resolvedIds = new Set(candidates.map((entry) => entry.id));
      return {
        name,
        scene: requireText(action.scene, `${slotId}.${name}.scene`),
        defaultSource: source,
        candidates,
        missingAssetIds: candidateIds.filter((assetId) => !resolvedIds.has(assetId)),
        cost: normalizeCost(action.cost),
        ...(textOrUndefined(action.generator) ? { generator: action.generator.trim() } : {}),
        ...(textOrUndefined(action.preset) ? { preset: action.preset.trim() } : {}),
        ...(textOrUndefined(action.requirement) ? { requirement: action.requirement.trim() } : {}),
        ...(textOrUndefined(action.generatedLabel) ? { generatedLabel: action.generatedLabel.trim() } : {}),
        ...(textOrUndefined(action.generatedModelSource) ? { generatedModelSource: action.generatedModelSource.trim() } : {}),
        ...(textOrUndefined(action.generatedReuseStatus) ? { generatedReuseStatus: action.generatedReuseStatus.trim() } : {}),
        ...(textOrUndefined(action.runtimeLabel) ? { runtimeLabel: action.runtimeLabel.trim() } : {}),
        ...(textOrUndefined(action.runtimeModelSource) ? { runtimeModelSource: action.runtimeModelSource.trim() } : {}),
        ...(textOrUndefined(action.runtimeSource) ? { runtimeSource: action.runtimeSource.trim() } : {}),
        ...(textOrUndefined(action.runtimeReuseStatus) ? { runtimeReuseStatus: action.runtimeReuseStatus.trim() } : {}),
        ...(textOrUndefined(action.linkedModelSource) ? { linkedModelSource: action.linkedModelSource.trim() } : {}),
        ...(action.generationRoute ? { generationRoute: normalizeGenerationRoute(action.generationRoute, `${slotId}.${name}.generationRoute`) } : {}),
      };
    });

    return {
      id: slotId,
      name,
      entityLabel: compactEntityLabel(requirement.entityLabel, name),
      role: requireText(requirement.role, `${slotId}.role`),
      assetKind: requireText(requirement.assetKind, `${slotId}.assetKind`),
      tier: requireText(requirement.tier ?? "key", `${slotId}.tier`),
      ...(textOrUndefined(requirement.rigModel) ? { rigModel: requirement.rigModel.trim() } : {}),
      ...(textOrUndefined(requirement.rigType) ? { rigType: requirement.rigType.trim() } : {}),
      model,
      actions,
    };
  });

  const proposal = {
    version: 1,
    schema: "shark-asset-sourcing-proposal",
    runId,
    ...(textOrUndefined(args.gameSummary) ? { gameSummary: args.gameSummary.trim() } : {}),
    intentSnapshot: buildIntentSnapshot(args.gameSummary, slots),
    slots,
  };
  return { ...proposal, totals: totalsForDefaults(proposal) };
}

export function normalizeConfirmedSourcingPlan(proposal, uiState, confirmedAt = new Date().toISOString()) {
  assertObject(proposal, "proposal");
  if (proposal.schema !== "shark-asset-sourcing-proposal" || !Array.isArray(proposal.slots)) {
    throw new Error("proposal must use shark-asset-sourcing-proposal");
  }
  assertObject(uiState, "uiState");
  assertObject(uiState.slots, "uiState.slots");

  const slots = proposal.slots.map((slot) => {
    const selection = uiState.slots[slot.id];
    assertObject(selection, `uiState.slots.${slot.id}`);
    const modelChoice = selection.model;
    assertObject(modelChoice, `${slot.id}.model`);
    const modelSource = requireEnum(modelChoice.source, MODEL_SOURCES, `${slot.id}.model.source`);
    const model = normalizeModelChoice(slot, modelChoice, modelSource);
    const actionChoices = selection.actions;
    assertObject(actionChoices, `${slot.id}.actions`);
    const actions = slot.actions.map((action) => normalizeActionChoice(slot, model, action, actionChoices[action.name]));
    return {
      id: slot.id,
      name: slot.name,
      entityLabel: compactEntityLabel(slot.entityLabel, slot.name),
      role: slot.role,
      assetKind: slot.assetKind,
      tier: slot.tier,
      ...(slot.rigModel ? { rigModel: slot.rigModel } : {}),
      ...(slot.rigType ? { rigType: slot.rigType } : {}),
      model,
      actions,
    };
  });

  const plan = {
    version: 1,
    schema: "shark-asset-sourcing-plan",
    runId: requireText(proposal.runId, "proposal.runId"),
    intentSnapshot: buildIntentSnapshot(proposal.gameSummary, proposal.slots),
    confirmation: {
      confirmed: true,
      confirmedBy: "user",
      confirmedAt: requireText(confirmedAt, "confirmedAt"),
    },
    slots,
  };
  return { ...plan, totals: totalsForPlan(plan) };
}

function buildIntentSnapshot(gameSummary, slots) {
  return {
    gameSummary: textOrUndefined(gameSummary) ?? "",
    slots: slots.map((slot) => ({
      id: slot.id,
      role: slot.role,
      assetKind: slot.assetKind,
      actions: slot.actions.map((action) => action.name),
    })),
  };
}

function buildLegacyManifest(args, entries) {
  const manifest = args.requirements.map((requirement, index) => {
    assertObject(requirement, `requirements[${index}]`);
    const need = requireText(requirement.need, `requirements[${index}].need`);
    const recommended = resolveEntry(requirement.recommendedAssetId, entries);
    const alternatives = resolveEntries(requirement.alternativeAssetIds, entries);
    return {
      need,
      recommended,
      alternatives,
      ...(textOrUndefined(requirement.reason) ? { reason: requirement.reason.trim() } : {}),
      missing: !recommended && alternatives.length === 0,
    };
  });
  return {
    manifest,
    ...(textOrUndefined(args.note) ? { note: args.note.trim() } : {}),
    instructions: "Show this manifest and obtain explicit confirmation before calling pull_asset_to_workspace.",
  };
}

function normalizeModelChoice(slot, choice, source) {
  if (source === "reuse_asset_center") {
    const candidate = modelCandidates(slot).find((entry) => entry.id === choice.assetId);
    if (!candidate) throw new Error(`${slot.id}: unknown Asset Center model ${String(choice.assetId)}`);
    return { source, assetId: candidate.id };
  }
  if (source === "reuse_project") {
    const candidate = slot.model.projectCandidates.find((entry) => entry.id === choice.assetId);
    if (!candidate) throw new Error(`${slot.id}: unknown project model ${String(choice.assetId)}`);
    return { source, assetId: candidate.id, resolved: { modelPath: candidate.modelPath } };
  }
  if (choice.assetId !== undefined) throw new Error(`${slot.id}: ${source} cannot carry assetId`);
  return {
    source,
    ...(source === "generate_new" && slot.model.generator ? { generator: slot.model.generator } : {}),
  };
}

function normalizeActionChoice(slot, model, action, choice) {
  assertObject(choice, `${slot.id}.${action.name}`);
  const source = requireEnum(choice.source, ACTION_SOURCES, `${slot.id}.${action.name}.source`);
  if (source === "reuse_linked_action" || source === "reuse_compatible_action") {
    const candidate = action.candidates.find((entry) => entry.id === choice.assetId);
    if (!candidate) throw new Error(`${slot.id}.${action.name}: unknown action asset ${String(choice.assetId)}`);
    if (source === "reuse_linked_action" && (!model.assetId || candidate.parentAssetId !== model.assetId)) {
      throw new Error(`${candidate.id} does not belong to selected base ${model.assetId ?? "<generated>"}`);
    }
    if (source === "reuse_compatible_action" && candidate.compatibility?.status !== "verified") {
      throw new Error(`${candidate.id} lacks verified compatibility`);
    }
    return {
      name: action.name,
      scene: action.scene,
      source,
      assetId: candidate.id,
      ...(candidate.parentAssetId ? { parentAssetId: candidate.parentAssetId } : {}),
    };
  }
  if (choice.assetId !== undefined) throw new Error(`${slot.id}.${action.name}: ${source} cannot carry assetId`);
  if (source === "generate_action") {
    if (model.source === "reuse_asset_center" || model.source === "reuse_project") {
      if (!action.generationRoute?.supportedForReusedBase) {
        throw new Error(`${slot.id}.${action.name}: generation route cannot animate a reused base`);
      }
    }
    if (!action.generator || !action.preset) throw new Error(`${slot.id}.${action.name}: generated action requires generator and preset`);
    return {
      name: action.name,
      scene: action.scene,
      source,
      generator: action.generator,
      preset: action.preset,
      cost: action.cost,
      ...(action.generationRoute ? { generationRoute: action.generationRoute } : {}),
    };
  }
  return { name: action.name, scene: action.scene, source, cost: 0 };
}

function totalsForDefaults(proposal) {
  let imports = 0;
  let generatedModels = 0;
  let generatedActions = 0;
  let runtimeActions = 0;
  let fallbacks = 0;
  let tripoCost = 0;
  for (const slot of proposal.slots) {
    if (slot.model.defaultSource === "reuse_asset_center" && slot.model.recommended) imports += 1;
    if (slot.model.defaultSource === "generate_new") generatedModels += 1;
    if (slot.model.defaultSource === "primitive_fallback") fallbacks += 1;
    for (const action of slot.actions) {
      if (action.defaultSource === "reuse_linked_action" || action.defaultSource === "reuse_compatible_action") imports += 1;
      if (action.defaultSource === "generate_action") {
        generatedActions += 1;
        tripoCost += action.cost;
      }
      if (action.defaultSource === "runtime_procedural") runtimeActions += 1;
      if (action.defaultSource === "primitive_fallback") fallbacks += 1;
    }
  }
  return { imports, generatedModels, generatedActions, runtimeActions, fallbacks, tripoCost };
}

function totalsForPlan(plan) {
  let imports = 0;
  let generatedModels = 0;
  let generatedActions = 0;
  let runtimeActions = 0;
  let fallbacks = 0;
  let tripoCost = 0;
  for (const slot of plan.slots) {
    if (slot.model.source === "reuse_asset_center") imports += 1;
    if (slot.model.source === "generate_new") generatedModels += 1;
    if (slot.model.source === "primitive_fallback") fallbacks += 1;
    for (const action of slot.actions) {
      if (action.source === "reuse_linked_action" || action.source === "reuse_compatible_action") imports += 1;
      if (action.source === "generate_action") {
        generatedActions += 1;
        tripoCost += action.cost ?? 0;
      }
      if (action.source === "runtime_procedural") runtimeActions += 1;
      if (action.source === "primitive_fallback") fallbacks += 1;
    }
  }
  return { imports, generatedModels, generatedActions, runtimeActions, fallbacks, tripoCost };
}

function normalizeProjectCandidates(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("projectCandidates must be an array");
  return value.map((candidate, index) => {
    assertObject(candidate, `projectCandidates[${index}]`);
    return {
      id: requireText(candidate.id, `projectCandidates[${index}].id`),
      displayName: requireText(candidate.displayName, `projectCandidates[${index}].displayName`),
      modelPath: requireSafeRelativePath(candidate.modelPath, `projectCandidates[${index}].modelPath`),
      source: "reuse_project",
    };
  });
}

function normalizeGenerationRoute(value, name) {
  assertObject(value, name);
  return {
    id: requireText(value.id, `${name}.id`),
    supportedForReusedBase: Boolean(value.supportedForReusedBase),
  };
}

function resolveEntries(value, entries) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("alternativeAssetIds must be an array");
  return value.map((assetId) => resolveEntry(assetId, entries)).filter(Boolean);
}

function resolveEntry(value, entries) {
  if (value === undefined || value === null || value === "") return null;
  const assetId = requireText(value, "assetId");
  const entry = entries.get(assetId);
  return entry ? publicCatalogEntry(entry) : null;
}

function publicCatalogEntry(entry) {
  return {
    id: entry.id,
    displayName: entry.displayName ?? entry.name ?? entry.id,
    ...(entry.category ? { category: entry.category } : {}),
    ...(entry.categoryLabel ? { categoryLabel: entry.categoryLabel } : {}),
    ...(entry.classification ? { classification: entry.classification } : {}),
    ...(entry.description ? { description: entry.description } : {}),
    animations: Array.isArray(entry.animations) ? entry.animations : [],
    ...(Number.isSafeInteger(entry.sizeBytes) ? { sizeBytes: entry.sizeBytes } : {}),
    ...(entry.parentAssetId ? { parentAssetId: entry.parentAssetId } : {}),
    ...(entry.parentDisplayName ? { parentDisplayName: entry.parentDisplayName } : {}),
    ...(entry.actionId ? { actionId: entry.actionId } : {}),
    ...(entry.previewUrl ? { previewUrl: entry.previewUrl } : {}),
    ...(entry.thumbnailUrl ? { thumbnailUrl: entry.thumbnailUrl } : {}),
    ...(entry.compatibility ? { compatibility: entry.compatibility } : {}),
    source: "reuse_asset_center",
  };
}

function modelCandidates(slot) {
  return [slot.model.recommended, ...(slot.model.alternatives ?? [])].filter(Boolean);
}

function requestedIds(recommended, alternatives) {
  const ids = [];
  if (recommended !== undefined && recommended !== null && recommended !== "") ids.push(requireText(recommended, "assetId"));
  if (alternatives !== undefined) {
    if (!Array.isArray(alternatives)) throw new Error("alternativeAssetIds must be an array");
    for (const assetId of alternatives) ids.push(requireText(assetId, "assetId"));
  }
  return [...new Set(ids)];
}

function catalogEntries(catalog) {
  if (Array.isArray(catalog?.categories)) return catalog.categories.flatMap((group) => Array.isArray(group?.assets) ? group.assets : []);
  return Array.isArray(catalog?.entries) ? catalog.entries : [];
}

function requireSafeRelativePath(value, name) {
  const candidate = requireText(value, name).replaceAll("\\", "/");
  if (candidate.startsWith("/") || candidate.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${name} must be a safe relative path`);
  }
  return candidate;
}

function normalizeCost(value) {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0) throw new Error("cost must be a non-negative number");
  return value;
}

function requireEnum(value, allowed, name) {
  const text = requireText(value, name);
  if (!allowed.has(text)) throw new Error(`${name} is invalid: ${text}`);
  return text;
}

function requireText(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function textOrUndefined(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compactEntityLabel(value, fallback) {
  const raw = textOrUndefined(value) ?? requireText(fallback, "entity label");
  const concise = raw.split(/[，,；;。:：\n]/, 1)[0].trim() || raw;
  const characters = Array.from(concise);
  return characters.length <= 16 ? concise : `${characters.slice(0, 15).join("")}…`;
}

function assertObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
}
