// 有效组合：飞机跨基地运行时，只允许采用当时当地对该构型有效的
// 方案版本、工卡修订、专用工具与放行人员的组合。

export const LEVELS = ["航线维修", "A检", "C检", "深度定检"];

// 授权层级向下覆盖：深度定检资质可放行 C检/A检/航线维修
export function levelCovers(granted, required) {
  return LEVELS.indexOf(granted) >= LEVELS.indexOf(required) && LEVELS.indexOf(required) >= 0;
}

const ts = (value) => Date.parse(value);

export function resolveCombination(network, { aircraftId, siteId, level, at }) {
  const violations = [];
  const aircraft = network.aircraft.find((item) => item.id === aircraftId);
  if (!aircraft) throw new Error(`未知飞机 ${aircraftId}`);
  const site = network.sites.find((item) => item.id === siteId);
  if (!site) throw new Error(`未知站点 ${siteId}`);
  const policy = network.policies.find((item) => item.site === siteId);
  if (!policy) throw new Error(`站点 ${siteId} 缺少一地一策策略`);

  // 1. 站点能力当下必须有效
  const capability = site.capabilities.find((item) => item.level === level && item.aircraftType === "C919");
  if (!capability) {
    violations.push({ code: "CAPABILITY_MISSING", message: `${site.name}未建立${level}能力` });
  } else if (capability.status !== "有效" || ts(capability.since) > ts(at)) {
    violations.push({ code: "CAPABILITY_SUSPENDED", message: `${site.name}${level}能力当前为${capability.status}` });
  }

  // 2. 维修方案版本须对该构型当时有效
  const program = network.programs.find((item) => item.id === policy.program && item.revision === policy.programRevision);
  if (!program) {
    violations.push({ code: "PROGRAM_UNKNOWN", message: `策略指定的方案 ${policy.program} ${policy.programRevision} 不存在` });
  } else {
    if (ts(program.effectiveFrom) > ts(at)) {
      violations.push({ code: "PROGRAM_NOT_EFFECTIVE", message: `方案 ${program.id} ${program.revision} 尚未生效` });
    }
    if (!program.appliesToConfigs.includes(aircraft.configuration)) {
      violations.push({ code: "PROGRAM_CONFIG_MISMATCH", message: `方案 ${program.revision} 不覆盖构型 ${aircraft.configuration}` });
    }
  }

  // 3. 工卡修订须为该站策略采用、当时生效且覆盖该构型
  const cards = [];
  const tasks = program ? program.tasks.filter((task) => task.level === level) : [];
  for (const task of tasks) {
    const revision = policy.workcardRevisions[task.card];
    const card = revision && network.workcards.find((item) => item.id === task.card && item.revision === revision);
    if (!card) {
      violations.push({ code: "CARD_NOT_ADOPTED", message: `站点策略未采用工卡 ${task.card} 的有效修订` });
      continue;
    }
    if (ts(card.effectiveFrom) > ts(at)) {
      violations.push({ code: "CARD_NOT_EFFECTIVE", message: `工卡 ${card.id} ${card.revision} 尚未生效` });
    }
    if (!card.appliesToConfigs.includes(aircraft.configuration)) {
      violations.push({ code: "CARD_CONFIG_MISMATCH", message: `工卡 ${card.id} ${card.revision} 不覆盖构型 ${aircraft.configuration}` });
    }
    cards.push({ card: card.id, revision: card.revision, title: card.title, requiredTools: card.requiredTools });
  }

  // 4. 已到强制日的适航指令所取代的工卡修订不得继续使用
  const applicableDirectives = network.directives.filter((item) => item.appliesToConfigs.includes(aircraft.configuration));
  for (const directive of applicableDirectives.filter((item) => ts(item.mandatoryFrom) <= ts(at))) {
    for (const superseded of directive.supersedesCards) {
      if (policy.workcardRevisions[superseded.card] === superseded.revision) {
        violations.push({ code: "CARD_SUPERSEDED", message: `工卡 ${superseded.card} ${superseded.revision} 已被 ${directive.id} 取代` });
      }
    }
  }

  // 5. 专用工具须在本站、在库且校准有效
  const neededTypes = [...new Set(cards.flatMap((card) => card.requiredTools))];
  const tools = [];
  for (const type of neededTypes) {
    const local = network.tools.filter((item) => item.type === type && item.custodian === siteId);
    const usable = local.find((item) => item.status === "在库" && ts(item.calibrationDue) >= ts(at));
    if (usable) {
      tools.push({ type, tool: usable.id, calibrationDue: usable.calibrationDue });
    } else if (local.some((item) => ts(item.calibrationDue) < ts(at))) {
      violations.push({ code: "TOOL_CALIBRATION_EXPIRED", message: `${site.name}的${type}校准已过期` });
    } else {
      violations.push({ code: "TOOL_UNAVAILABLE", message: `${site.name}缺少可用${type}` });
    }
  }

  // 6. 至少一名放行人员的授权覆盖该层级与该站点
  const releasers = network.personnel
    .filter((person) => person.authorizations.some((auth) =>
      auth.aircraftType === "C919"
      && auth.sites.includes(siteId)
      && levelCovers(auth.level, level)
      && ts(auth.validFrom) <= ts(at)
      && ts(auth.validTo) >= ts(at)))
    .map((person) => person.id);
  if (releasers.length === 0) {
    violations.push({ code: "NO_AUTHORIZED_RELEASER", message: `${site.name}无覆盖${level}的放行授权人员` });
  }

  // 7. 已到强制日的适航指令必须已在该机上执行
  const pending = applicableDirectives.filter((directive) =>
    ts(directive.mandatoryFrom) <= ts(at)
    && !aircraft.embodiedDirectives.some((item) => item.id === directive.id && item.amendment === directive.amendment));
  for (const directive of pending) {
    violations.push({ code: "DIRECTIVE_PENDING", message: `适航指令 ${directive.id} ${directive.amendment} 未执行` });
  }

  return {
    ok: violations.length === 0,
    aircraft: aircraftId,
    configuration: aircraft.configuration,
    site: siteId,
    level,
    at,
    programRevision: policy.programRevision,
    cards,
    tools,
    releasers,
    pendingDirectives: pending.map((directive) => directive.id),
    violations,
  };
}

// 管理者视图：各站点真实可承接的维修层级。
// 用“已执行全部适用指令”的探针机按构型逐一评估，只反映站点侧因素。
export function siteCapabilityReport(network, at) {
  const configurations = [...new Set(network.aircraft.map((item) => item.configuration))];
  const rows = [];
  for (const site of network.sites) {
    for (const level of LEVELS) {
      const probes = configurations.map((configuration) => ({
        id: `PROBE-${configuration}`,
        configuration,
        embodiedDirectives: network.directives
          .filter((directive) => directive.appliesToConfigs.includes(configuration))
          .map((directive) => ({ id: directive.id, amendment: directive.amendment, at })),
      }));
      const violations = probes.flatMap((probe) =>
        resolveCombination({ ...network, aircraft: probes }, { aircraftId: probe.id, siteId: site.id, level, at }).violations);
      rows.push({
        site: site.id,
        name: site.name,
        level,
        available: violations.length === 0,
        reasons: [...new Set(violations.map((violation) => violation.message))],
      });
    }
  }
  return rows;
}
