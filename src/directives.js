// 定检进行中遇到适航指令升级：明确继续、追加还是退回。
// 判定依据：指令是否适用该构型、是否取代已签署工卡、是否新增项目，
// 以及新增项目是否超出本站能力（超出时给出异地支援候选）。

export function assessDirectiveUpgrade(network, { releaseId, directiveId, at }) {
  const release = network.releases.find((item) => item.id === releaseId);
  if (!release) throw new Error(`未知放行/定检记录 ${releaseId}`);
  if (release.closedAt) throw new Error(`${releaseId} 已关闭，指令升级应另开工单评估`);
  const directive = network.directives.find((item) => item.id === directiveId);
  if (!directive) throw new Error(`未知适航指令 ${directiveId}`);
  const aircraft = network.aircraft.find((item) => item.id === release.aircraft);
  const policy = network.policies.find((item) => item.site === release.site);

  if (!directive.appliesToConfigs.includes(aircraft.configuration)) {
    return {
      release: releaseId,
      directive: directiveId,
      decision: "继续",
      rationale: "指令不适用于该机构型，定检照常进行",
      returnedCards: [],
      addedCards: [],
      support: null,
    };
  }

  // 已签署但被指令取代的工卡 → 退回重做
  const returnedCards = release.cards
    .filter((card) => directive.supersedesCards.some((item) => item.card === card.card && item.revision === card.revision))
    .map((card) => ({ card: card.card, revision: card.revision, reason: `已被 ${directive.id} ${directive.amendment} 取代，须退回重做` }));

  // 指令新增且不在当前工作包内的工卡 → 追加
  const addedCards = directive.addsCards
    .filter((cardId) => !release.cards.some((card) => card.card === cardId))
    .map((cardId) => {
      const revision = policy.workcardRevisions[cardId] ?? latestRevision(network, cardId);
      const definition = network.workcards.find((item) => item.id === cardId && item.revision === revision);
      return definition
        ? { card: cardId, revision: definition.revision, title: definition.title, level: definition.level }
        : { card: cardId, revision, title: null, level: null };
    });

  // 追加项目超出本站能力时，按策略的支援顺序给出异地支援候选
  let support = null;
  const lackingLevels = [...new Set(addedCards.filter((card) => card.level && !capableAt(network, release.site, card.level, at)).map((card) => card.level))];
  if (lackingLevels.length > 0) {
    const preferred = (policy.supportFrom ?? []).filter((siteId) => lackingLevels.every((level) => capableAt(network, siteId, level, at)));
    const others = network.sites
      .filter((site) => site.id !== release.site && !preferred.includes(site.id))
      .map((site) => site.id)
      .filter((siteId) => lackingLevels.every((level) => capableAt(network, siteId, level, at)));
    support = { needed: true, levels: lackingLevels, candidates: [...preferred, ...others] };
  }

  const decision = returnedCards.length > 0 ? "退回" : addedCards.length > 0 ? "追加" : "继续";
  const rationale = decision === "退回"
    ? `已签署工卡被取代：${returnedCards.map((card) => `${card.card} ${card.revision}`).join("、")}，须退回${addedCards.length > 0 ? `并追加 ${addedCards.map((card) => card.card).join("、")}` : ""}`
    : decision === "追加"
      ? `指令新增项目：${addedCards.map((card) => card.card).join("、")}，并入当前定检`
      : "指令不影响当前定检已开展的项目，继续执行";

  return { release: releaseId, directive: directiveId, decision, rationale, returnedCards, addedCards, support };
}

function latestRevision(network, cardId) {
  const definitions = network.workcards.filter((item) => item.id === cardId);
  return definitions.length > 0 ? definitions[definitions.length - 1].revision : undefined;
}

function capableAt(network, siteId, level, at) {
  const site = network.sites.find((item) => item.id === siteId);
  return Boolean(site?.capabilities.some((item) =>
    item.level === level && item.status === "有效" && Date.parse(item.since) <= Date.parse(at)));
}
