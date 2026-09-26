// 放行追溯：从一次放行回溯工卡、工具、部件与签署证据链。

export function traceRelease(network, events, releaseId) {
  const release = events.find((e) => e.type === "release" && e.release === releaseId);
  if (!release) return null;
  const check = network.checks.find((c) => c.id === release.check) ?? null;

  // 同一定检下的全部事件即该次放行的证据链，按审计序号排列
  const related = events.filter((e) => e.check === release.check).sort((a, b) => a.seq - b.seq);
  const signoffs = related.filter((e) => e.type === "workcard_signoff");
  const swaps = related.filter((e) => e.type === "part_swap");

  return {
    release,
    check,
    signoffs,
    swaps,
    handovers: related.filter((e) => e.type === "shift_handover"),
    adDispositions: related.filter((e) => e.type === "ad_disposition"),
    workcards: signoffs.map((e) => ({ card: e.card, revision: e.revision, variant: e.variant ?? null })),
    tools: [...new Set(signoffs.flatMap((e) => e.tools_used ?? []))],
    parts: [...new Set(swaps.flatMap((e) => [e.removed.sn, e.installed.sn]))],
    signers: [...new Set(signoffs.flatMap((e) => e.signers.map((s) => s.id)))],
    evidence: related.map((e) => e.seq)
  };
}
