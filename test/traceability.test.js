import test from "node:test";
import assert from "node:assert/strict";
import { loadNetwork } from "../src/catalog.js";
import { traceRelease } from "../src/traceability.js";

test("一次放行可追到工卡、工具、部件与签署证据", async () => {
  const network = await loadNetwork();
  const result = traceRelease(network, "RL-2026-0001");
  assert.ok(result.ok, JSON.stringify(result.findings));
  assert.equal(result.evidence.cards.length, 2);
  assert.equal(result.evidence.tools.length, 2);
  assert.equal(result.evidence.parts.length, 2);
  assert.equal(result.evidence.signatures.length, 2);
  assert.equal(result.evidence.audit.events, 6);
  // 证据内容可核对
  assert.deepEqual(result.evidence.cards.map((card) => `${card.card}@${card.revision}`), ["WC-1001@R2", "WC-2001@R3"]);
  assert.deepEqual(result.evidence.parts.map((part) => `${part.direction}:${part.serial}`), ["装上:SN-L001", "拆下:SN-L009"]);
});

test("签署版工卡与站点采用版不一致被发现", async () => {
  const network = await loadNetwork();
  // RL-2026-0002 中 WC-1002 按 R1 签署，而广州基地策略已采用 R2
  const result = traceRelease(network, "RL-2026-0002");
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((finding) => finding.code === "CARD_REVISION_MISMATCH"));
});

test("授权过期人员签署被发现", async () => {
  const network = await loadNetwork();
  const clone = structuredClone(network);
  clone.releases.push({
    id: "RL-X",
    aircraft: "AC-08",
    site: "GA01",
    level: "航线维修",
    openedAt: "2026-09-10T07:00:00+08:00",
    closedAt: "2026-09-10T09:00:00+08:00",
    cards: [],
    toolsUsed: [],
    partsInstalled: [],
    partsRemoved: [],
    signatures: [{ person: "P-04", role: "放行", signedAt: "2026-09-10T08:30:00+08:00", seq: 1 }],
    auditRefs: [],
  });
  const result = traceRelease(clone, "RL-X");
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((finding) => finding.code === "SIGNATURE_NOT_AUTHORIZED"));
});

test("放行引用的审计事件缺失被发现", async () => {
  const network = await loadNetwork();
  const clone = structuredClone(network);
  clone.releases.find((release) => release.id === "RL-2026-0001").auditRefs = [1, 2, 99];
  const result = traceRelease(clone, "RL-2026-0001");
  assert.ok(result.findings.some((finding) => finding.code === "AUDIT_GAP"));
});
