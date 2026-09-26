// 领域不变量校验：对网络快照与审计事件流执行全部业务规则检查。
// 规则清单见 README「关键业务规则」。每个问题以中文描述返回，便于审计阅读。

const ts = (iso) => Date.parse(iso);
const dayOf = (iso) => iso.slice(0, 10);

const CAPABILITY_CODES = ["LINE", "A_CHECK", "C_CHECK", "DEEP_CHECK"];
const LOCATION_PATTERN = /^(STORE|QUARANTINE|SHOP)-[A-Z0-9]+$/;

const indexBy = (list, key) => new Map(list.map((item) => [item[key], item]));

// 人员在 at 时刻是否持有覆盖 站点/层级/角色 的有效授权；level、role 传 null 表示不限制
function hasAuthorization(network, personId, site, level, role, at) {
  const person = network.personnel.find((p) => p.id === personId);
  if (!person) return false;
  const day = dayOf(at);
  return person.qualifications.some(
    (q) =>
      q.sites.includes(site) &&
      (level === null || q.levels.includes(level)) &&
      (role === null || q.roles.includes(role)) &&
      q.valid_from <= day &&
      day <= q.valid_to
  );
}

// 按借用/归还事件推算 toolId 在 at 时刻的保管站点
function custodyAt(network, loanEvents, toolId, at) {
  let custody = network.baseline.tools[toolId];
  for (const e of loanEvents) {
    if (e.tool === toolId && ts(e.occurred_at) <= ts(at)) custody = e.to_site;
  }
  return custody;
}

// —— 快照结构性校验：引用闭合、寿命限制、基线完整 ——
export function validateNetwork(network) {
  const problems = [];
  const sites = indexBy(network.sites, "id");
  const aircraft = indexBy(network.aircraft, "id");
  const configs = new Set(network.configurations.map((c) => c.id));

  if (sites.size !== network.sites.length) problems.push("站点编号重复");
  if (aircraft.size !== network.aircraft.length) problems.push("飞机编号重复");

  for (const site of network.sites) {
    const codes = site.capabilities.map((c) => c.code);
    if (new Set(codes).size !== codes.length) problems.push(`站点 ${site.id} 能力代码重复`);
  }
  for (const a of network.aircraft) {
    if (!configs.has(a.config)) problems.push(`飞机 ${a.id} 引用未知构型 ${a.config}`);
    if (!sites.has(a.home)) problems.push(`飞机 ${a.id} 归属未知站点 ${a.home}`);
    if (!sites.has(a.at)) problems.push(`飞机 ${a.id} 位于未知站点 ${a.at}`);
  }

  const cards = indexBy(network.workcards, "id");
  for (const p of network.programs) {
    for (const cfg of p.applicable_configs) {
      if (!configs.has(cfg)) problems.push(`方案 ${p.id}@${p.revision} 引用未知构型 ${cfg}`);
    }
    for (const w of p.workcards) {
      const card = cards.get(w.card);
      if (!card) {
        problems.push(`方案 ${p.id}@${p.revision} 引用未知工卡 ${w.card}`);
      } else if (!card.revisions.some((r) => r.rev === w.revision)) {
        problems.push(`方案 ${p.id}@${p.revision} 引用工卡 ${w.card} 不存在的修订 ${w.revision}`);
      }
    }
  }
  for (const card of network.workcards) {
    const revs = card.revisions.map((r) => r.rev);
    if (new Set(revs).size !== revs.length) problems.push(`工卡 ${card.id} 修订号重复`);
    for (const cfg of card.applicable_configs) {
      if (!configs.has(cfg)) problems.push(`工卡 ${card.id} 引用未知构型 ${cfg}`);
    }
  }
  for (const d of network.directives) {
    for (const cfg of d.applicable_configs) {
      if (!configs.has(cfg)) problems.push(`适航指令 ${d.id}@${d.revision} 引用未知构型 ${cfg}`);
    }
  }
  for (const person of network.personnel) {
    for (const q of person.qualifications) {
      for (const s of q.sites) {
        if (!sites.has(s)) problems.push(`人员 ${person.id} 授权引用未知站点 ${s}`);
      }
      for (const level of q.levels) {
        if (!CAPABILITY_CODES.includes(level)) problems.push(`人员 ${person.id} 授权引用未知维修层级 ${level}`);
      }
      if (q.valid_from > q.valid_to) problems.push(`人员 ${person.id} 授权有效期起止颠倒`);
    }
  }
  for (const tool of network.tools) {
    if (!sites.has(tool.home_site)) problems.push(`工具 ${tool.id} 归属未知站点 ${tool.home_site}`);
    if (!sites.has(tool.custody)) problems.push(`工具 ${tool.id} 保管权指向未知站点 ${tool.custody}`);
  }
  for (const part of network.parts) {
    if (!aircraft.has(part.location) && !LOCATION_PATTERN.test(part.location)) {
      problems.push(`部件 ${part.sn} 所在位置 ${part.location} 无法识别`);
    }
    for (const [dim, used] of Object.entries(part.used)) {
      const limit = part.life_limit[dim];
      if (limit === undefined) problems.push(`部件 ${part.sn} 寿命维度 ${dim} 缺少限制值`);
      else if (used > limit) problems.push(`部件 ${part.sn} 已用寿命 ${used} 超过限制 ${limit}`);
    }
  }
  for (const f of network.flights) {
    if (!aircraft.has(f.aircraft)) problems.push(`航班 ${f.id} 引用未知飞机 ${f.aircraft}`);
    if (!sites.has(f.from) || !sites.has(f.to)) problems.push(`航班 ${f.id} 引用未知站点`);
    if (ts(f.dep) >= ts(f.arr)) problems.push(`航班 ${f.id} 起降时间颠倒`);
  }
  const programKeys = new Set(network.programs.map((p) => `${p.id}@${p.revision}`));
  for (const c of network.checks) {
    if (!aircraft.has(c.aircraft)) problems.push(`定检 ${c.id} 引用未知飞机 ${c.aircraft}`);
    if (!sites.has(c.site)) problems.push(`定检 ${c.id} 引用未知站点 ${c.site}`);
    if (!CAPABILITY_CODES.includes(c.level)) problems.push(`定检 ${c.id} 维修层级未知 ${c.level}`);
    if (!programKeys.has(`${c.program}@${c.program_revision}`)) {
      problems.push(`定检 ${c.id} 引用未知方案版本 ${c.program}@${c.program_revision}`);
    }
  }

  // 守恒校验的前提：基线必须完整覆盖当前登记的部件与工具
  const sameKeys = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  if (!sameKeys(Object.keys(network.baseline.parts), network.parts.map((p) => p.sn))) {
    problems.push("基线部件清单与当前部件清单不一致");
  }
  if (!sameKeys(Object.keys(network.baseline.tools), network.tools.map((t) => t.id))) {
    problems.push("基线工具清单与当前工具清单不一致");
  }
  return problems;
}

// —— 事件流校验：审计顺序、组合有效性、授权、校准、指令处置、故障合并 ——
export function validateEvents(network, events) {
  const problems = [];
  const checks = indexBy(network.checks, "id");
  const aircraft = indexBy(network.aircraft, "id");
  const sites = indexBy(network.sites, "id");
  const cards = indexBy(network.workcards, "id");
  const tools = indexBy(network.tools, "id");
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const loanEvents = ordered.filter((e) => e.type === "tool_loan" || e.type === "tool_return");

  // 审计顺序：序号连续、记录时间单调、发生时间不晚于记录时间、乱序补传必须标记
  ordered.forEach((e, i) => {
    if (e.seq !== i + 1) problems.push(`事件流第 ${i + 1} 位序号为 ${e.seq}，审计序号不连续`);
    if (ts(e.occurred_at) > ts(e.recorded_at)) problems.push(`事件 ${e.seq} 发生时间晚于记录时间`);
    if (i > 0 && ts(e.recorded_at) < ts(ordered[i - 1].recorded_at)) {
      problems.push(`事件 ${e.seq} 记录时间早于前序事件，破坏审计顺序`);
    }
  });
  let maxOccurred = Number.NEGATIVE_INFINITY;
  for (const e of ordered) {
    if (ts(e.occurred_at) < maxOccurred && e.channel !== "offline_backfill") {
      problems.push(`事件 ${e.seq} 发生时间乱序且未标记离线补传`);
    }
    maxOccurred = Math.max(maxOccurred, ts(e.occurred_at));
  }

  for (const e of ordered) {
    if (e.type === "workcard_signoff") {
      const check = checks.get(e.check);
      if (!check) {
        problems.push(`事件 ${e.seq} 引用未知定检 ${e.check}`);
        continue;
      }
      if (check.status === "planned") problems.push(`事件 ${e.seq} 签署挂在未开工定检 ${check.id}`);
      const ac = aircraft.get(check.aircraft);
      const day = dayOf(e.occurred_at);

      // 组合有效性：构型 × 方案版本 × 工卡修订 × 站点适配版在发生时刻同时有效
      const program = network.programs.find((p) => p.id === check.program && p.revision === check.program_revision);
      if (program) {
        if (!program.applicable_configs.includes(ac.config)) {
          problems.push(`事件 ${e.seq} 方案 ${program.id}@${program.revision} 不适用于构型 ${ac.config}`);
        }
        if (program.valid_from > day || (program.valid_to && program.valid_to < day)) {
          problems.push(`事件 ${e.seq} 方案 ${program.id}@${program.revision} 在签署时刻未生效`);
        }
        if (!program.workcards.some((w) => w.card === e.card && w.revision === e.revision)) {
          problems.push(`事件 ${e.seq} 工卡 ${e.card}@${e.revision} 不在方案 ${program.id}@${program.revision} 的有效组合内`);
        }
      }
      const card = cards.get(e.card);
      if (!card) {
        problems.push(`事件 ${e.seq} 引用未知工卡 ${e.card}`);
        continue;
      }
      const rev = card.revisions.find((r) => r.rev === e.revision);
      if (!rev) {
        problems.push(`事件 ${e.seq} 工卡 ${e.card} 无修订 ${e.revision}`);
      } else {
        if (rev.status !== "effective") problems.push(`事件 ${e.seq} 工卡 ${e.card}@${e.revision} 已非有效修订`);
        if (rev.effective_from > day || (rev.effective_to && rev.effective_to < day)) {
          problems.push(`事件 ${e.seq} 工卡 ${e.card}@${e.revision} 在签署时刻未生效`);
        }
      }
      if (!card.applicable_configs.includes(ac.config)) {
        problems.push(`事件 ${e.seq} 工卡 ${e.card} 不适用于构型 ${ac.config}`);
      }
      const variant = sites.get(check.site)?.local_policy.workcard_variants[`${e.card}@${e.revision}`];
      if (variant && e.variant !== variant) problems.push(`事件 ${e.seq} 在 ${check.site} 应使用站点适配工卡 ${variant}`);
      if (!variant && e.variant) problems.push(`事件 ${e.seq} 使用了未登记的站点适配工卡 ${e.variant}`);

      // 多人签署：双签工卡要求执行与检验角色齐备且签署人互不相同
      const ids = e.signers.map((s) => s.id);
      if (new Set(ids).size !== ids.length) problems.push(`事件 ${e.seq} 签署人重复`);
      if (card.dual_sign) {
        const roles = e.signers.map((s) => s.role);
        if (!(roles.includes("perform") && roles.includes("inspect"))) {
          problems.push(`事件 ${e.seq} 工卡 ${e.card} 要求执行与检验双签`);
        }
      }
      for (const s of e.signers) {
        if (!hasAuthorization(network, s.id, check.site, check.level, s.role, e.occurred_at)) {
          problems.push(`事件 ${e.seq} 签署人 ${s.id} 在 ${check.site}/${check.level}/${s.role} 无有效授权`);
        }
      }

      // 工具：校准有效且保管权在使用站点
      for (const toolId of e.tools_used ?? []) {
        const tool = tools.get(toolId);
        if (!tool) {
          problems.push(`事件 ${e.seq} 引用未知工具 ${toolId}`);
          continue;
        }
        if (tool.calibration.valid_until < day) problems.push(`事件 ${e.seq} 工具 ${toolId} 校准已超期`);
        const custody = custodyAt(network, loanEvents, toolId, e.occurred_at);
        if (custody !== check.site) {
          problems.push(`事件 ${e.seq} 工具 ${toolId} 保管权在 ${custody}，不能在 ${check.site} 使用`);
        }
      }
    }

    if (e.type === "part_swap") {
      const check = checks.get(e.check);
      if (!check) {
        problems.push(`事件 ${e.seq} 引用未知定检 ${e.check}`);
        continue;
      }
      if (e.aircraft !== check.aircraft) problems.push(`事件 ${e.seq} 拆换飞机与定检飞机不一致`);
      if (!hasAuthorization(network, e.actor, check.site, check.level, "perform", e.occurred_at)) {
        problems.push(`事件 ${e.seq} 拆换执行人 ${e.actor} 无有效授权`);
      }
    }

    if (e.type === "release") {
      const check = checks.get(e.check);
      if (!check) {
        problems.push(`事件 ${e.seq} 引用未知定检 ${e.check}`);
        continue;
      }
      if (check.release !== e.release) problems.push(`事件 ${e.seq} 放行编号与定检记录不一致`);
      if (check.status !== "released") problems.push(`事件 ${e.seq} 对应定检未处于已放行状态`);
      if (!hasAuthorization(network, e.actor, check.site, check.level, "release", e.occurred_at)) {
        problems.push(`事件 ${e.seq} 放行人 ${e.actor} 无有效放行授权`);
      }
      const hasSignoff = ordered.some((x) => x.type === "workcard_signoff" && x.check === check.id && x.seq < e.seq);
      if (!hasSignoff) problems.push(`事件 ${e.seq} 放行前无任何工卡签署`);
    }

    if (e.type === "check_opened") {
      const check = checks.get(e.check);
      if (!check) {
        problems.push(`事件 ${e.seq} 引用未知定检 ${e.check}`);
        continue;
      }
      if (check.aircraft !== e.aircraft || check.level !== e.level || check.program_revision !== e.program_revision) {
        problems.push(`事件 ${e.seq} 开工信息与定检记录不一致`);
      }
    }

    if (e.type === "shift_handover") {
      const check = checks.get(e.check);
      if (!check) {
        problems.push(`事件 ${e.seq} 引用未知定检 ${e.check}`);
        continue;
      }
      if (check.opened && ts(e.occurred_at) < ts(check.opened)) problems.push(`事件 ${e.seq} 交接早于定检开工`);
      if (!e.outgoing?.length || !e.incoming?.length) problems.push(`事件 ${e.seq} 交接双方不完整`);
    }

    if (e.type === "tool_loan" || e.type === "tool_return") {
      if (!tools.has(e.tool)) problems.push(`事件 ${e.seq} 引用未知工具 ${e.tool}`);
      if (!sites.has(e.from_site) || !sites.has(e.to_site)) problems.push(`事件 ${e.seq} 借用站点未知`);
    }

    if (e.type === "ad_revision_published") {
      if (!network.directives.some((d) => d.id === e.directive && d.revision === e.revision)) {
        problems.push(`事件 ${e.seq} 引用未知适航指令 ${e.directive}@${e.revision}`);
      }
    }

    if (e.type === "ad_disposition") {
      const check = checks.get(e.check);
      if (!check) {
        problems.push(`事件 ${e.seq} 引用未知定检 ${e.check}`);
        continue;
      }
      if (check.opened && ts(e.occurred_at) < ts(check.opened)) problems.push(`事件 ${e.seq} 处置早于定检开工`);
      if (check.closed && ts(e.occurred_at) > ts(check.closed)) problems.push(`事件 ${e.seq} 处置晚于定检关闭`);
      const authorized =
        hasAuthorization(network, e.actor, check.site, check.level, "perform", e.occurred_at) ||
        hasAuthorization(network, e.actor, check.site, check.level, "release", e.occurred_at);
      if (!authorized) problems.push(`事件 ${e.seq} 处置人 ${e.actor} 无有效授权`);
      const published = ordered.some(
        (x) => x.type === "ad_revision_published" && x.directive === e.directive && x.revision === e.revision && x.seq < e.seq
      );
      if (!published) problems.push(`事件 ${e.seq} 处置的指令修订 ${e.directive}@${e.revision} 尚未发布`);
    }

    if (e.type === "fault_report") {
      if (!aircraft.has(e.aircraft)) problems.push(`事件 ${e.seq} 引用未知飞机 ${e.aircraft}`);
      if (!hasAuthorization(network, e.actor, e.site, null, null, e.occurred_at)) {
        problems.push(`事件 ${e.seq} 报告人 ${e.actor} 在 ${e.site} 无有效授权`);
      }
    }

    if (e.type === "fault_merge") {
      if (!hasAuthorization(network, e.actor, e.site, null, null, e.occurred_at)) {
        problems.push(`事件 ${e.seq} 合并操作人 ${e.actor} 在 ${e.site} 无有效授权`);
      }
    }

    if (e.type === "capability_suspension") {
      const site = sites.get(e.site);
      if (!site) {
        problems.push(`事件 ${e.seq} 引用未知站点 ${e.site}`);
        continue;
      }
      if (!site.capabilities.some((c) => c.code === e.capability)) {
        problems.push(`事件 ${e.seq} 暂停了站点 ${e.site} 未声明的能力 ${e.capability}`);
      }
      if (e.to && ts(e.to) <= ts(e.from)) problems.push(`事件 ${e.seq} 暂停时段起止颠倒`);
    }
  }

  // 重复故障合并：主故障与被合并故障必须已建档，不重复合并，不以被合并故障为主
  const reports = new Map();
  for (const e of ordered) {
    if (e.type === "fault_report") {
      if (reports.has(e.fault)) problems.push(`故障 ${e.fault} 重复建档`);
      reports.set(e.fault, e.seq);
    }
  }
  const mergedInto = new Map();
  for (const e of ordered) {
    if (e.type !== "fault_merge") continue;
    if (!reports.has(e.primary)) problems.push(`事件 ${e.seq} 主故障 ${e.primary} 不存在`);
    else if (reports.get(e.primary) > e.seq) problems.push(`事件 ${e.seq} 合并早于主故障报告`);
    if (mergedInto.has(e.primary)) problems.push(`事件 ${e.seq} 主故障 ${e.primary} 本身已被合并`);
    for (const f of e.merged) {
      if (!reports.has(f)) {
        problems.push(`事件 ${e.seq} 被合并故障 ${f} 不存在`);
        continue;
      }
      if (reports.get(f) > e.seq) problems.push(`事件 ${e.seq} 合并早于故障 ${f} 的报告`);
      if (f === e.primary) problems.push(`事件 ${e.seq} 故障 ${f} 不能合并到自身`);
      if (mergedInto.has(f)) problems.push(`事件 ${e.seq} 故障 ${f} 被重复合并`);
      mergedInto.set(f, e.primary);
    }
  }

  // 适航指令升级：执行窗口内发布的适用修订，必须有继续/追加/退回处置且处置先于放行
  for (const check of network.checks) {
    if (!check.opened) continue;
    const start = ts(check.opened);
    const end = check.closed ? ts(check.closed) : ts(network.as_of);
    const ac = aircraft.get(check.aircraft);
    for (const pub of ordered.filter((e) => e.type === "ad_revision_published")) {
      const at = ts(pub.occurred_at);
      if (at < start || at > end) continue;
      const directive = network.directives.find((d) => d.id === pub.directive && d.revision === pub.revision);
      if (!directive || !directive.applicable_configs.includes(ac.config)) continue;
      const disposition = ordered.find(
        (e) => e.type === "ad_disposition" && e.directive === pub.directive && e.revision === pub.revision && e.check === check.id
      );
      if (!disposition) {
        problems.push(`定检 ${check.id} 执行期间遇 ${pub.directive}@${pub.revision} 升级，缺少继续/追加/退回处置`);
        continue;
      }
      const release = ordered.find((e) => e.type === "release" && e.check === check.id);
      if (release && disposition.seq > release.seq) {
        problems.push(`定检 ${check.id} 的放行早于 ${pub.directive}@${pub.revision} 处置`);
      }
    }
  }
  return problems;
}

// —— 数量守恒：从基线重放拆换与借用事件，必须回到当前快照（账实相符） ——
export function validateConservation(network, events) {
  const problems = [];
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const partLocation = { ...network.baseline.parts };
  const toolCustody = { ...network.baseline.tools };
  const knownParts = new Set(network.parts.map((p) => p.sn));
  const knownTools = new Set(network.tools.map((t) => t.id));

  for (const e of ordered) {
    if (e.type === "part_swap") {
      for (const sn of [e.removed.sn, e.installed.sn]) {
        if (!knownParts.has(sn)) problems.push(`事件 ${e.seq} 部件 ${sn} 未登记，部件数量不守恒`);
      }
      if (partLocation[e.removed.sn] !== undefined && partLocation[e.removed.sn] !== e.aircraft) {
        problems.push(`事件 ${e.seq} 拆下件 ${e.removed.sn} 实际在 ${partLocation[e.removed.sn]}，不在 ${e.aircraft}`);
      }
      if (partLocation[e.installed.sn] !== undefined && partLocation[e.installed.sn] !== e.installed.source) {
        problems.push(`事件 ${e.seq} 装上件 ${e.installed.sn} 实际在 ${partLocation[e.installed.sn]}，与声明来源 ${e.installed.source} 不符`);
      }
      partLocation[e.removed.sn] = e.removed.destination;
      partLocation[e.installed.sn] = e.aircraft;
    }
    if (e.type === "tool_loan" || e.type === "tool_return") {
      if (knownTools.has(e.tool) && toolCustody[e.tool] !== e.from_site) {
        problems.push(`事件 ${e.seq} 工具 ${e.tool} 保管权在 ${toolCustody[e.tool]}，不能从 ${e.from_site} 发出`);
      }
      toolCustody[e.tool] = e.to_site;
    }
  }
  for (const part of network.parts) {
    if (partLocation[part.sn] !== part.location) {
      problems.push(`部件 ${part.sn} 账实不符：流水推算在 ${partLocation[part.sn]}，快照登记在 ${part.location}`);
    }
  }
  for (const tool of network.tools) {
    if (toolCustody[tool.id] !== tool.custody) {
      problems.push(`工具 ${tool.id} 账实不符：流水推算在 ${toolCustody[tool.id]}，快照登记在 ${tool.custody}`);
    }
  }
  return problems;
}

export function validateAll(network, events) {
  return [...validateNetwork(network), ...validateEvents(network, events), ...validateConservation(network, events)];
}
