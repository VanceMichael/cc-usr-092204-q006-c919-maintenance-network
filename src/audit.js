import { createHash } from "node:crypto";

// 审计链：每个站点一条只增不改的哈希链。
// 多人签署、夜间交接、离线补传、重复故障合并都不得破坏链内顺序：
// - 事件按站点序号入链，前后以哈希衔接；
// - 离线机场使用预先分配的号段在本地封签，恢复后按序号归位，重复补传幂等；
// - 交接班事件必须交班与接班双方签署；
// - 合并故障只追加合并事件，原始故障报告保留。

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashEvent(event) {
  const { hash, ...rest } = event;
  return createHash("sha256").update(stableStringify(rest)).digest("hex");
}

export class AuditChain {
  constructor(site) {
    this.site = site;
    this.events = [];
    this.pending = [];
  }

  #head() {
    return this.events.length > 0 ? this.events[this.events.length - 1].hash : "GENESIS";
  }

  // 在线事件：立即编号入链
  append({ type, at, actor, payload = {}, signatures = [] }) {
    const event = { site: this.site, seq: this.events.length + 1, type, at, actor, payload, signatures, prevHash: this.#head() };
    event.hash = hashEvent(event);
    this.events.push(event);
    return event;
  }

  // 离线端封签：网络中断期间按预留号段在本地链接
  sealOffline(rawEvents) {
    let prevHash = this.#head();
    let seq = this.events.length;
    return rawEvents.map((raw) => {
      seq = raw.seq ?? seq + 1;
      const event = {
        site: this.site,
        seq,
        type: raw.type,
        at: raw.at,
        actor: raw.actor,
        payload: raw.payload ?? {},
        signatures: raw.signatures ?? [],
        prevHash,
      };
      event.hash = hashEvent(event);
      prevHash = event.hash;
      return event;
    });
  }

  // 补传：按序号归位；乱序到达先暂存，重复补传幂等
  receiveOffline(sealedEvents) {
    const inserted = [];
    for (const event of sealedEvents) {
      if (hashEvent(event) !== event.hash) throw new Error(`补传事件哈希不自洽 seq=${event.seq}`);
      if (this.events.some((item) => item.seq === event.seq) || this.pending.some((item) => item.seq === event.seq)) continue;
      this.pending.push(event);
      inserted.push(event.seq);
    }
    this.#drain();
    return inserted;
  }

  #drain() {
    for (;;) {
      const nextSeq = this.events.length + 1;
      const index = this.pending.findIndex((event) => event.seq === nextSeq);
      if (index < 0) return;
      const [event] = this.pending.splice(index, 1);
      if (event.prevHash !== this.#head()) throw new Error(`补传事件前向哈希断裂 seq=${event.seq}`);
      this.events.push(event);
    }
  }

  verify() {
    const problems = [];
    this.events.forEach((event, index) => {
      if (event.seq !== index + 1) problems.push({ code: "SEQ_GAP", seq: event.seq, message: "序号不连续" });
      const expectedPrev = index > 0 ? this.events[index - 1].hash : "GENESIS";
      if (event.prevHash !== expectedPrev) problems.push({ code: "HASH_BREAK", seq: event.seq, message: "前向哈希断裂" });
      if (hashEvent(event) !== event.hash) problems.push({ code: "HASH_TAMPERED", seq: event.seq, message: "事件哈希被篡改" });

      const signatures = event.signatures ?? [];
      for (let i = 1; i < signatures.length; i += 1) {
        if (Date.parse(signatures[i].signedAt) < Date.parse(signatures[i - 1].signedAt)) {
          problems.push({ code: "SIGNATURE_ORDER", seq: event.seq, message: "多人签署顺序倒置" });
        }
      }
      if (event.type === "交接班" && signatures.length !== 2) {
        problems.push({ code: "HANDOVER_SIGNATURES", seq: event.seq, message: "交接班须交班与接班双方签署" });
      }
      if (event.type === "合并故障") {
        const knownFaults = new Set(
          this.events.filter((item) => item.type === "故障报告" && item.seq < event.seq).map((item) => item.payload.fault),
        );
        for (const fault of event.payload.mergedFrom ?? []) {
          if (!knownFaults.has(fault)) problems.push({ code: "MERGE_UNKNOWN_FAULT", seq: event.seq, fault, message: `合并引用了不存在的故障 ${fault}` });
        }
      }
    });
    return { ok: problems.length === 0, problems, pending: this.pending.map((event) => event.seq) };
  }
}

// 按站点重放原始事件：在线事件直接入链，离线事件先封签再补传
export function replay(site, rawEvents) {
  const chain = new AuditChain(site);
  const sorted = [...rawEvents].sort((a, b) => a.seq - b.seq);
  let index = 0;
  while (index < sorted.length) {
    if (sorted[index].offline) {
      const batch = [];
      while (index < sorted.length && sorted[index].offline) {
        batch.push(sorted[index]);
        index += 1;
      }
      chain.receiveOffline(chain.sealOffline(batch));
    } else {
      chain.append(sorted[index]);
      index += 1;
    }
  }
  return chain;
}

// 多站点审计视图：各站链内顺序不变，按时间合并展示
export function mergeChains(...chains) {
  return chains
    .flatMap((chain) => chain.events)
    .sort((a, b) => {
      if (a.at !== b.at) return Date.parse(a.at) - Date.parse(b.at);
      if (a.site !== b.site) return a.site < b.site ? -1 : 1;
      return a.seq - b.seq;
    });
}
