// 能力暂停影响分析：某项能力暂停时，立即找出受影响飞机与后续航班，
// 并列出仍具备该能力的站点作为异地支援去向。

export function assessSuspension(network, { siteId, level, at, horizonDays = 7 }) {
  const site = network.sites.find((item) => item.id === siteId);
  if (!site) throw new Error(`未知站点 ${siteId}`);
  const day = at.slice(0, 10);
  const until = new Date(Date.parse(day) + horizonDays * 86400000).toISOString().slice(0, 10);

  const affectedFlights = network.flights.filter((flight) =>
    flight.site === siteId && flight.requiresLevel === level && flight.date >= day && flight.date <= until);

  // 在检飞机：该站有未关闭的同层级定检记录
  const aircraftInCheck = network.releases
    .filter((release) => !release.closedAt && release.site === siteId && release.level === level)
    .map((release) => release.aircraft);

  const affectedAircraft = [...new Set([...affectedFlights.map((flight) => flight.aircraft), ...aircraftInCheck])];

  const alternatives = network.sites
    .filter((item) => item.id !== siteId)
    .filter((item) => item.capabilities.some((capability) =>
      capability.level === level && capability.status === "有效" && Date.parse(capability.since) <= Date.parse(day)))
    .map((item) => item.id);

  return {
    site: siteId,
    level,
    at: day,
    horizonDays,
    affectedAircraft,
    affectedFlights: affectedFlights.map((flight) => flight.id),
    alternatives,
  };
}
