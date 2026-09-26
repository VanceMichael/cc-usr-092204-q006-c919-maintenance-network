// 守恒台账：拆换件与借用工具的数量和去向必须守恒。
// 每个带序号物品在任意时刻必须恰好处于一个位置；流转单的发出位置
// 必须与台账当前位置一致；借出/送校未归还的物品单独列出。

export function verifyConservation({ initialPositions, movements }) {
  const positions = { ...initialPositions };
  const discrepancies = [];
  const seenSeq = new Set();
  const sorted = [...movements].sort((a, b) => a.seq - b.seq);

  for (const movement of sorted) {
    if (seenSeq.has(movement.seq)) {
      discrepancies.push({ code: "DUPLICATE_SEQ", seq: movement.seq, message: `流转序号 ${movement.seq} 重复` });
    }
    seenSeq.add(movement.seq);

    const current = positions[movement.item];
    if (current === undefined) {
      discrepancies.push({ code: "UNKNOWN_ITEM", item: movement.item, seq: movement.seq, message: `${movement.item} 不在台账中` });
      continue;
    }
    if (current !== movement.from) {
      discrepancies.push({
        code: "SOURCE_MISMATCH",
        item: movement.item,
        seq: movement.seq,
        expected: current,
        actual: movement.from,
        message: `${movement.item} 实际在 ${current}，流转单却从 ${movement.from} 发出`,
      });
      continue;
    }
    positions[movement.item] = movement.to;
  }

  if (Object.keys(positions).length !== Object.keys(initialPositions).length) {
    discrepancies.push({ code: "COUNT_CHANGED", message: "台账物品总数发生变化" });
  }

  // 未闭环的借出与送校
  const lastMovement = {};
  for (const movement of sorted) lastMovement[movement.item] = movement;
  const outstanding = Object.values(lastMovement)
    .filter((movement) => movement.kind === "借出" || movement.kind === "送校")
    .map((movement) => ({ item: movement.item, kind: movement.kind, holder: movement.to, since: movement.at }));

  return { balanced: discrepancies.length === 0, positions, outstanding, discrepancies };
}

// 单个物品的去向追踪
export function traceItem(movements, itemId) {
  return movements
    .filter((movement) => movement.item === itemId)
    .sort((a, b) => a.seq - b.seq)
    .map((movement) => ({ seq: movement.seq, kind: movement.kind, from: movement.from, to: movement.to, at: movement.at }));
}
