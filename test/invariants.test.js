import test from "node:test";
import assert from "node:assert/strict";
import { loadNetwork, loadEvents } from "../src/catalog.js";
import { validateAll } from "../src/invariants.js";

const load = async () => {
  const [network, eventsDoc] = await Promise.all([loadNetwork(), loadEvents()]);
  return { network, events: eventsDoc.events };
};

test("网络快照与事件流满足全部不变量", async () => {
  const { network, events } = await load();
  assert.deepEqual(validateAll(network, events), []);
});

test("缺少适航指令处置会被发现", async () => {
  const { network, events } = await load();
  const broken = events.filter((e) => e.type !== "ad_disposition");
  const problems = validateAll(network, broken);
  assert.ok(problems.some((p) => p.includes("CHK-301") && p.includes("AD-2026-018")));
});

test("部件去向与快照不一致会被发现", async () => {
  const { network, events } = await load();
  const broken = structuredClone(network);
  broken.parts.find((p) => p.sn === "PN-1001-0007").location = "STORE-CAN";
  const problems = validateAll(broken, events);
  assert.ok(problems.some((p) => p.includes("PN-1001-0007") && p.includes("账实不符")));
});

test("未标记的离线补传会被发现", async () => {
  const { network, events } = await load();
  const broken = structuredClone(events);
  broken.find((e) => e.fault === "F-101").channel = "online";
  const problems = validateAll(network, broken);
  assert.ok(problems.some((p) => p.includes("离线补传")));
});

test("无授权人员签署会被发现", async () => {
  const { network, events } = await load();
  const broken = structuredClone(events);
  // P-1003 仅授权 LINE/A_CHECK，不能签署深度定检工卡
  broken.find((e) => e.seq === 9).signers[0].id = "P-1003";
  const problems = validateAll(network, broken);
  assert.ok(problems.some((p) => p.includes("P-1003") && p.includes("无有效授权")));
});

test("工具外借期间被原地使用会被发现", async () => {
  const { network, events } = await load();
  const broken = structuredClone(events);
  // TL-5003 已借往 GA1，却在 CAN 的定检中使用
  broken.find((e) => e.seq === 9).tools_used = ["TL-5003"];
  const problems = validateAll(network, broken);
  assert.ok(problems.some((p) => p.includes("TL-5003") && p.includes("保管权")));
});

test("跨基地未使用站点适配工卡会被发现", async () => {
  const { network, events } = await load();
  const broken = structuredClone(events);
  delete broken.find((e) => e.seq === 6).variant;
  const problems = validateAll(network, broken);
  assert.ok(problems.some((p) => p.includes("WC-ENG-001-CAN-R2")));
});

test("放行早于指令处置会被发现", async () => {
  const { network, events } = await load();
  const broken = structuredClone(events);
  // 让 CHK-301 在处置前就放行
  const release = {
    seq: 14,
    type: "release",
    occurred_at: "2026-09-26T09:30:00+08:00",
    recorded_at: "2026-09-26T09:30:00+08:00",
    channel: "online",
    site: "CAN",
    actor: "P-1002",
    release: "REL-7002",
    check: "CHK-301",
    aircraft: "AC03"
  };
  broken.find((e) => e.type === "ad_disposition").seq = 15;
  broken.find((e) => e.type === "ad_disposition").occurred_at = "2026-09-26T09:45:00+08:00";
  broken.find((e) => e.type === "ad_disposition").recorded_at = "2026-09-26T09:45:00+08:00";
  broken.find((e) => e.type === "capability_suspension").seq = 16;
  broken.push(release);
  const net = structuredClone(network);
  net.checks.find((c) => c.id === "CHK-301").status = "released";
  net.checks.find((c) => c.id === "CHK-301").release = "REL-7002";
  net.checks.find((c) => c.id === "CHK-301").closed = "2026-09-26T09:30:00+08:00";
  const problems = validateAll(net, broken);
  assert.ok(problems.some((p) => p.includes("CHK-301") && p.includes("放行早于")));
});
