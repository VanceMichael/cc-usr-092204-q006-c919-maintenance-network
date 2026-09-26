import test from "node:test";
import assert from "node:assert/strict";
import { loadNetwork } from "../src/catalog.js";
import { assessSuspension } from "../src/impact.js";

test("通航机场能力暂停：定位受影响飞机与航班并给出替代站点", async () => {
  const network = await loadNetwork();
  const result = assessSuspension(network, { siteId: "GA03", level: "航线维修", at: "2026-09-26" });
  assert.deepEqual(result.affectedAircraft, ["AC-05"]);
  assert.deepEqual(result.affectedFlights, ["FL-9101"]);
  assert.deepEqual(result.alternatives, ["GZ", "HN", "GA01", "GA02"]);
});

test("基地 A检暂停：定检计划中的飞机受影响", async () => {
  const network = await loadNetwork();
  const result = assessSuspension(network, { siteId: "HN", level: "A检", at: "2026-09-26" });
  assert.deepEqual(result.affectedAircraft, ["AC-07"]);
  assert.deepEqual(result.affectedFlights, ["FL-9201"]);
  assert.deepEqual(result.alternatives, ["GZ"]);
});

test("深度定检能力暂停：在检飞机立即被找出，且无替代站点", async () => {
  const network = await loadNetwork();
  const result = assessSuspension(network, { siteId: "GZ", level: "深度定检", at: "2026-09-26" });
  assert.deepEqual(result.affectedAircraft, ["AC-02"]);
  assert.deepEqual(result.alternatives, []);
});

test("超出影响窗口的航班不计入", async () => {
  const network = await loadNetwork();
  const result = assessSuspension(network, { siteId: "GA01", level: "航线维修", at: "2026-09-26", horizonDays: 2 });
  assert.deepEqual(result.affectedFlights, ["FL-9102"]);
});
