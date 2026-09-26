// 能力暂停影响分析与各地真实可承接层级评估。

const ts = (iso) => Date.parse(iso);

// 某项能力暂停时，立即找出受影响的定检、飞机与后续航班。
// suspension: { site, capability, from, to? }（to 缺省表示持续有效）
export function suspensionImpact(network, suspension) {
  const from = ts(suspension.from);
  const to = suspension.to ? ts(suspension.to) : Number.POSITIVE_INFINITY;
  const inWindow = (iso) => {
    const at = ts(iso);
    return at >= from && at < to;
  };

  // 与暂停时段相交的定检：在检按 [opened, closed/∞)，计划按 planned_for 时点
  const checks = network.checks.filter((c) => {
    if (c.site !== suspension.site || c.level !== suspension.capability) return false;
    if (c.status === "released" || c.status === "returned") return false;
    const start = c.opened ?? c.planned_for;
    const end = c.closed ?? (c.opened ? null : c.planned_for);
    const endTs = end ? ts(end) : Number.POSITIVE_INFINITY;
    return ts(start) < to && endTs >= from;
  });

  const flights = network.flights.filter(
    (f) => (f.from === suspension.site || f.to === suspension.site) && (inWindow(f.dep) || inWindow(f.arr))
  );

  const aircraftReasons = new Map();
  const note = (id, reason) => {
    if (!aircraftReasons.has(id)) aircraftReasons.set(id, new Set());
    aircraftReasons.get(id).add(reason);
  };
  for (const a of network.aircraft) {
    if (a.at === suspension.site) note(a.id, "驻留该站");
  }
  for (const c of checks) note(c.aircraft, `定检 ${c.id} 需要该能力`);
  for (const f of flights) note(f.aircraft, `航班 ${f.id} 涉及该站`);

  return {
    suspension,
    affected_checks: checks.map((c) => c.id),
    affected_flights: flights.map((f) => f.id),
    affected_aircraft: [...aircraftReasons.entries()]
      .map(([id, reasons]) => ({ id, reasons: [...reasons] }))
      .sort((a, b) => a.id.localeCompare(b.id))
  };
}

// 各地真实可承接的维修层级：声明能力 × 未暂停 × 有有效放行授权。
// 返回每个站点每项能力的有效性与失效原因，供管理者掌握真实承接能力。
export function effectiveCapabilities(network, events, at) {
  const day = at.slice(0, 10);
  const atTs = ts(at);
  const suspensions = events.filter((e) => e.type === "capability_suspension");

  return network.sites.map((site) => ({
    site: site.id,
    capabilities: site.capabilities.map((cap) => {
      const reasons = [];
      if (cap.status !== "active") reasons.push(`declared_${cap.status}`);
      const suspended = suspensions.some(
        (s) => s.site === site.id && s.capability === cap.code && ts(s.from) <= atTs && (!s.to || atTs < ts(s.to))
      );
      if (suspended) reasons.push("suspended_by_event");
      const staffed = network.personnel.some((p) =>
        p.qualifications.some(
          (q) =>
            q.sites.includes(site.id) &&
            q.levels.includes(cap.code) &&
            q.roles.includes("release") &&
            q.valid_from <= day &&
            day <= q.valid_to
        )
      );
      if (!staffed) reasons.push("no_valid_release_authorization");
      return { code: cap.code, effective: reasons.length === 0, reasons };
    })
  }));
}
