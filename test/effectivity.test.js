import test from "node:test";
import assert from "node:assert/strict";
import { loadNetwork } from "../src/catalog.js";
import { resolveCombination, siteCapabilityReport } from "../src/effectivity.js";

const AT = "2026-09-26";

test("主基地有效组合成立", async () => {
  const network = await loadNetwork();
  const result = resolveCombination(network, { aircraftId: "AC-01", siteId: "GZ", level: "A检", at: AT });
  assert.ok(result.ok, JSON.stringify(result.violations));
  assert.deepEqual(result.cards.map((card) => `${card.card}@${card.revision}`), ["WC-2001@R3", "WC-2005@R1"]);
  assert.equal(result.tools.length, 2);
  assert.ok(result.releasers.includes("P-01") && result.releasers.includes("P-02"));
});

test("能力暂停的站点不得使用", async () => {
  const network = await loadNetwork();
  const result = resolveCombination(network, { aircraftId: "AC-01", siteId: "GA03", level: "航线维修", at: AT });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((violation) => violation.code === "CAPABILITY_SUSPENDED"));
});

test("工具校准过期使组合不成立", async () => {
  const network = await loadNetwork();
  const result = resolveCombination(network, { aircraftId: "AC-07", siteId: "HN", level: "A检", at: AT });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((violation) => violation.code === "TOOL_CALIBRATION_EXPIRED"));
});

test("到期适航指令未执行不得放行", async () => {
  const network = await loadNetwork();
  const result = resolveCombination(network, { aircraftId: "AC-02", siteId: "GZ", level: "航线维修", at: AT });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((violation) => violation.code === "DIRECTIVE_PENDING"));
  assert.deepEqual(result.pendingDirectives, ["AD-2026-001"]);
});

test("指令强制日后被取代的工卡修订不得继续使用", async () => {
  const network = await loadNetwork();
  // 湖南基地策略仍采用 WC-1002 R1，AD-2026-002 于 2026-10-01 强制
  const result = resolveCombination(network, { aircraftId: "AC-07", siteId: "HN", level: "航线维修", at: "2026-10-02" });
  assert.ok(result.violations.some((violation) => violation.code === "CARD_SUPERSEDED"));
});

test("跨基地运行使用当地组合", async () => {
  const network = await loadNetwork();
  // CFG-B 飞机在通航机场一：使用当地策略、当地工具、当地授权
  const result = resolveCombination(network, { aircraftId: "AC-12", siteId: "GA01", level: "航线维修", at: AT });
  assert.ok(result.ok, JSON.stringify(result.violations));
  assert.deepEqual(result.tools.map((tool) => tool.tool), ["TL-007"]);
  assert.deepEqual(result.releasers, ["P-03"]);
});

test("管理者视图：真实可承接层级", async () => {
  const network = await loadNetwork();
  const rows = siteCapabilityReport(network, AT);
  const find = (site, level) => rows.find((row) => row.site === site && row.level === level);

  assert.equal(find("GZ", "深度定检").available, true);
  assert.equal(find("GA01", "航线维修").available, true);
  // 湖南基地 A检：孔探仪校准过期，纸面能力不等于可承接
  const hnA = find("HN", "A检");
  assert.equal(hnA.available, false);
  assert.ok(hnA.reasons.some((reason) => reason.includes("校准已过期")));
  // 通航机场三航线维修暂停
  assert.equal(find("GA03", "航线维修").available, false);
  // 湖南基地 C检无放行授权人员
  assert.equal(find("HN", "C检").available, false);
});
