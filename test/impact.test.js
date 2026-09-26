import test from "node:test";
import assert from "node:assert/strict";
import { loadNetwork, loadEvents } from "../src/catalog.js";
import { suspensionImpact, effectiveCapabilities } from "../src/impact.js";

const load = async () => {
  const [network, eventsDoc] = await Promise.all([loadNetwork(), loadEvents()]);
  return { network, events: eventsDoc.events };
};

test("能力暂停立即定位受影响定检、航班与飞机", async () => {
  const { network } = await load();
  const impact = suspensionImpact(network, {
    site: "GA2",
    capability: "LINE",
    from: "2026-09-26T10:00:00+08:00"
  });
  assert.deepEqual(impact.affected_checks, ["CHK-306"]);
  assert.deepEqual(impact.affected_flights, ["FLT-9101", "FLT-9102", "FLT-9103"]);
  assert.deepEqual(
    impact.affected_aircraft.map((a) => a.id),
    ["AC06", "AC08"]
  );
  const ac08 = impact.affected_aircraft.find((a) => a.id === "AC08");
  assert.ok(ac08.reasons.some((r) => r.includes("驻留")));
});

test("暂停窗口之外的航班与定检不受影响", async () => {
  const { network } = await load();
  const impact = suspensionImpact(network, {
    site: "GA2",
    capability: "LINE",
    from: "2026-09-28T00:00:00+08:00",
    to: "2026-09-29T00:00:00+08:00"
  });
  assert.deepEqual(impact.affected_checks, []);
  assert.deepEqual(impact.affected_flights, []);
  assert.deepEqual(
    impact.affected_aircraft.map((a) => a.id),
    ["AC08"]
  );
});

test("各地真实可承接层级综合声明、暂停与放行授权", async () => {
  const { network, events } = await load();
  const caps = effectiveCapabilities(network, events, "2026-09-26T11:00:00+08:00");
  const at = (site, code) => caps.find((s) => s.site === site).capabilities.find((c) => c.code === code);

  assert.equal(at("CAN", "DEEP_CHECK").effective, true);
  assert.equal(at("GA1", "LINE").effective, true);

  // GA2 航线能力：事件暂停 + 唯一放行授权到期
  assert.equal(at("GA2", "LINE").effective, false);
  assert.deepEqual(at("GA2", "LINE").reasons, ["suspended_by_event", "no_valid_release_authorization"]);

  // CSX 声明了 C 检能力，但缺少有效放行授权，真实不可承接
  assert.equal(at("CSX", "C_CHECK").effective, false);
  assert.deepEqual(at("CSX", "C_CHECK").reasons, ["no_valid_release_authorization"]);
});
