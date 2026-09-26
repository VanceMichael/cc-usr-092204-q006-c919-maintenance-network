import { replay } from "./audit.js";
import { levelCovers } from "./effectivity.js";

// 放行追溯：从一次放行追到工卡修订、工具校准、部件寿命与签署证据，
// 并核对审计链上留有对应记录。

export function traceRelease(network, releaseId) {
  const release = network.releases.find((item) => item.id === releaseId);
  if (!release) throw new Error(`未知放行记录 ${releaseId}`);
  const policy = network.policies.find((item) => item.site === release.site);

  const cards = release.cards.map((card) => {
    const definition = network.workcards.find((item) => item.id === card.card && item.revision === card.revision);
    const findings = [];
    if (!definition) findings.push({ code: "CARD_UNKNOWN", message: `工卡 ${card.card} ${card.revision} 不存在` });
    const adopted = policy.workcardRevisions[card.card];
    if (adopted !== card.revision) {
      findings.push({ code: "CARD_REVISION_MISMATCH", message: `工卡 ${card.card} 签署版 ${card.revision} 与站点采用版 ${adopted ?? "未采用"} 不一致` });
    }
    return { ...card, title: definition?.title ?? null, findings };
  });

  const tools = release.toolsUsed.map((usage) => {
    const tool = network.tools.find((item) => item.id === usage.tool);
    const findings = [];
    if (!tool) findings.push({ code: "TOOL_UNKNOWN", message: `工具 ${usage.tool} 不存在` });
    else if (Date.parse(tool.calibrationDue) < Date.parse(usage.usedAt)) {
      findings.push({ code: "TOOL_CALIBRATION_INVALID", message: `工具 ${usage.tool} 使用时校准已过期（${tool.calibrationDue}）` });
    }
    return { ...usage, type: tool?.type ?? null, calibrationDue: tool?.calibrationDue ?? null, findings };
  });

  const parts = [
    ...release.partsInstalled.map((part) => ({ ...part, direction: "装上" })),
    ...release.partsRemoved.map((part) => ({ ...part, direction: "拆下" })),
  ].map((part) => {
    const component = network.components.find((item) => item.serial === part.serial);
    const findings = [];
    if (!component) findings.push({ code: "PART_UNKNOWN", message: `部件 ${part.serial} 不存在` });
    else if (part.direction === "装上" && component.consumedCycles > component.lifeLimitCycles) {
      findings.push({ code: "PART_LIFE_EXCEEDED", message: `部件 ${part.serial} 装机时已超寿命` });
    }
    return { ...part, partNumber: component?.partNumber ?? null, findings };
  });

  const signatures = release.signatures.map((signature, index) => {
    const person = network.personnel.find((item) => item.id === signature.person);
    const findings = [];
    const authorized = person?.authorizations.some((auth) =>
      auth.aircraftType === "C919"
      && auth.sites.includes(release.site)
      && levelCovers(auth.level, release.level)
      && Date.parse(auth.validFrom) <= Date.parse(signature.signedAt)
      && Date.parse(auth.validTo) >= Date.parse(signature.signedAt));
    if (!authorized) {
      findings.push({ code: "SIGNATURE_NOT_AUTHORIZED", message: `${signature.person} 签署时无 ${release.site} ${release.level} 有效授权` });
    }
    if (index > 0 && signature.seq <= release.signatures[index - 1].seq) {
      findings.push({ code: "SIGNATURE_ORDER", message: "签署序号未递增" });
    }
    return { ...signature, name: person?.name ?? null, findings };
  });

  // 审计链核对：重放该站事件，确认链完整且放行引用的记录都在链上
  const chain = replay(release.site, network.auditEvents[release.site] ?? []);
  const auditProblems = chain.verify().problems;
  const missingRefs = release.auditRefs.filter((seq) => !chain.events.some((event) => event.seq === seq));
  const auditFindings = [
    ...auditProblems,
    ...missingRefs.map((seq) => ({ code: "AUDIT_GAP", message: `审计链缺少放行引用的事件 seq=${seq}` })),
  ];

  const findings = [
    ...cards.flatMap((card) => card.findings),
    ...tools.flatMap((tool) => tool.findings),
    ...parts.flatMap((part) => part.findings),
    ...signatures.flatMap((signature) => signature.findings),
    ...auditFindings,
  ];

  return {
    release,
    evidence: {
      cards,
      tools,
      parts,
      signatures,
      audit: { events: chain.events.length, problems: auditFindings },
    },
    findings,
    ok: findings.length === 0,
  };
}
