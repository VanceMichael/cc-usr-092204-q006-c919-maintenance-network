import test from "node:test";
import assert from "node:assert/strict";
import { loadNetwork } from "../src/catalog.js";
import { AuditChain, replay, mergeChains } from "../src/audit.js";

test("在线链重放后校验通过", async () => {
  const network = await loadNetwork();
  const chain = replay("GZ", network.auditEvents.GZ);
  assert.equal(chain.events.length, 6);
  assert.ok(chain.verify().ok, JSON.stringify(chain.verify().problems));
});

test("离线补传乱序归位且重复补传幂等", async () => {
  const network = await loadNetwork();
  const raw = network.auditEvents.GA01;
  const chain = new AuditChain("GA01");
  for (const event of raw.filter((item) => !item.offline && item.seq <= 5)) chain.append(event);

  const sealed = chain.sealOffline(raw.filter((item) => item.offline));
  assert.deepEqual(sealed.map((event) => event.seq), [6, 7, 8]);

  // 8 号先到：暂存，主链不动
  assert.deepEqual(chain.receiveOffline([sealed[2]]), [8]);
  assert.equal(chain.events.length, 5);
  assert.deepEqual(chain.verify().pending, [8]);

  // 6、7 到达后按序归位；8 重复补传被忽略
  chain.receiveOffline([sealed[0], sealed[1], sealed[2]]);
  assert.equal(chain.events.length, 8);
  assert.ok(chain.verify().ok);
});

test("篡改事件被哈希链发现", async () => {
  const network = await loadNetwork();
  const chain = replay("GZ", network.auditEvents.GZ);
  chain.events[2].payload.card = "WC-9999";
  const result = chain.verify();
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.code === "HASH_TAMPERED" && problem.seq === 3));
});

test("夜间交接班必须双方签署", () => {
  const chain = new AuditChain("T");
  chain.append({
    type: "交接班",
    at: "2026-09-15T00:00:00+08:00",
    actor: "P-1",
    payload: { openItems: [] },
    signatures: [{ person: "P-1", signedAt: "2026-09-15T00:00:00+08:00" }],
  });
  assert.ok(chain.verify().problems.some((problem) => problem.code === "HANDOVER_SIGNATURES"));
});

test("多人签署时间不得倒置", () => {
  const chain = new AuditChain("T");
  chain.append({
    type: "交接班",
    at: "2026-09-15T00:00:00+08:00",
    actor: "P-1",
    payload: {},
    signatures: [
      { person: "P-1", signedAt: "2026-09-15T00:10:00+08:00" },
      { person: "P-2", signedAt: "2026-09-15T00:05:00+08:00" },
    ],
  });
  assert.ok(chain.verify().problems.some((problem) => problem.code === "SIGNATURE_ORDER"));
});

test("重复故障合并保留原报告且校验引用", async () => {
  const network = await loadNetwork();
  const chain = replay("GA01", network.auditEvents.GA01);
  assert.ok(chain.verify().ok, JSON.stringify(chain.verify().problems));
  // 合并不删除原件：两份故障报告仍在链上
  assert.equal(chain.events.filter((event) => event.type === "故障报告").length, 2);

  const bad = new AuditChain("T");
  bad.append({ type: "合并故障", at: "2026-09-19T09:00:00+08:00", actor: "P-1", payload: { into: "F-1", mergedFrom: ["F-9"] } });
  assert.ok(bad.verify().problems.some((problem) => problem.code === "MERGE_UNKNOWN_FAULT"));
});

test("多站合并视图保持各站链内顺序", async () => {
  const network = await loadNetwork();
  const gz = replay("GZ", network.auditEvents.GZ);
  const ga = replay("GA01", network.auditEvents.GA01);
  const merged = mergeChains(gz, ga);
  assert.equal(merged.length, 15);
  const gaSeqs = merged.filter((event) => event.site === "GA01").map((event) => event.seq);
  assert.deepEqual(gaSeqs, [...gaSeqs].sort((a, b) => a - b));
});
