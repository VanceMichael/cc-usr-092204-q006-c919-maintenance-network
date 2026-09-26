import test from "node:test";
import assert from "node:assert/strict";
import { loadNetwork } from "../src/catalog.js";
import { assessDirectiveUpgrade } from "../src/directives.js";

test("定检中遇指令升级：退回被取代工卡并追加新项目", async () => {
  const network = await loadNetwork();
  const result = assessDirectiveUpgrade(network, { releaseId: "RL-2026-0002", directiveId: "AD-2026-002", at: "2026-09-26" });
  assert.equal(result.decision, "退回");
  assert.deepEqual(result.returnedCards.map((card) => `${card.card}@${card.revision}`), ["WC-1002@R1"]);
  assert.deepEqual(result.addedCards.map((card) => card.card), ["WC-2005"]);
  assert.equal(result.support, null);
});

test("指令不适用于该构型：继续", async () => {
  const network = await loadNetwork();
  // AD-2026-003 只适用 CFG-B，AC-02 是 CFG-A
  const result = assessDirectiveUpgrade(network, { releaseId: "RL-2026-0002", directiveId: "AD-2026-003", at: "2026-09-26" });
  assert.equal(result.decision, "继续");
  assert.equal(result.returnedCards.length, 0);
  assert.equal(result.addedCards.length, 0);
});

test("追加项目超出本站能力时给出异地支援候选", async () => {
  const network = await loadNetwork();
  const clone = structuredClone(network);
  // 把同一场景搬到只有航线能力的通航机场一
  clone.releases.find((release) => release.id === "RL-2026-0002").site = "GA01";
  const result = assessDirectiveUpgrade(clone, { releaseId: "RL-2026-0002", directiveId: "AD-2026-002", at: "2026-09-26" });
  assert.ok(result.support.needed);
  assert.deepEqual(result.support.levels, ["A检"]);
  // 策略优先来源 GZ 在前，其余具备能力的站点随后
  assert.deepEqual(result.support.candidates, ["GZ", "HN"]);
});

test("已关闭的定检不得在原地评估指令升级", async () => {
  const network = await loadNetwork();
  assert.throws(
    () => assessDirectiveUpgrade(network, { releaseId: "RL-2026-0001", directiveId: "AD-2026-002", at: "2026-09-26" }),
    /已关闭/,
  );
});
