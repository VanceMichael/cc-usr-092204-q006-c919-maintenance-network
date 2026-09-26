import test from "node:test";
import assert from "node:assert/strict";
import { loadNetwork } from "../src/catalog.js";
import { verifyConservation, traceItem } from "../src/conservation.js";

test("样例台账守恒，借出与送校未闭环被列出", async () => {
  const network = await loadNetwork();
  const result = verifyConservation(network);
  assert.ok(result.balanced, JSON.stringify(result.discrepancies));
  assert.deepEqual(
    result.outstanding.map((item) => `${item.item}@${item.holder}`).sort(),
    ["TL-006@GZ", "TL-009@CAL-01"],
  );
});

test("发出位置与台账不符即破坏守恒", () => {
  const result = verifyConservation({
    initialPositions: { "X-1": "A站" },
    movements: [{ seq: 1, kind: "借出", item: "X-1", from: "B站", to: "C站", at: "2026-09-01" }],
  });
  assert.equal(result.balanced, false);
  assert.equal(result.discrepancies[0].code, "SOURCE_MISMATCH");
});

test("流转序号重复被拒绝", () => {
  const result = verifyConservation({
    initialPositions: { "X-1": "A站" },
    movements: [
      { seq: 1, kind: "借出", item: "X-1", from: "A站", to: "B站", at: "2026-09-01" },
      { seq: 1, kind: "归还", item: "X-1", from: "B站", to: "A站", at: "2026-09-02" },
    ],
  });
  assert.ok(result.discrepancies.some((item) => item.code === "DUPLICATE_SEQ"));
});

test("未入账物品不得流转", () => {
  const result = verifyConservation({
    initialPositions: {},
    movements: [{ seq: 1, kind: "装上", item: "SN-X", from: "GZ", to: "AC-01", at: "2026-09-01" }],
  });
  assert.ok(result.discrepancies.some((item) => item.code === "UNKNOWN_ITEM"));
});

test("单件去向可追踪", async () => {
  const network = await loadNetwork();
  const history = traceItem(network.movements, "SN-L009");
  assert.deepEqual(history.map((entry) => `${entry.kind}:${entry.from}->${entry.to}`), ["拆下:AC-01->GZ-待检"]);
  const engine = traceItem(network.movements, "SN-E003");
  assert.deepEqual(engine.map((entry) => entry.to), ["AC-03"]);
});
