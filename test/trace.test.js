import test from "node:test";
import assert from "node:assert/strict";
import { loadNetwork, loadEvents } from "../src/catalog.js";
import { traceRelease } from "../src/trace.js";

test("从一次放行追到工卡、工具、部件与签署证据", async () => {
  const [network, eventsDoc] = await Promise.all([loadNetwork(), loadEvents()]);
  const trace = traceRelease(network, eventsDoc.events, "REL-7001");

  assert.equal(trace.check.id, "CHK-288");
  assert.equal(trace.release.actor, "P-1005");
  assert.deepEqual(trace.workcards, [{ card: "WC-LDG-014", revision: "R3", variant: null }]);
  assert.deepEqual(trace.tools, ["TL-5002"]);
  assert.deepEqual([...trace.parts].sort(), ["PN-2002-0009", "PN-2002-0011"]);
  assert.deepEqual([...trace.signers].sort(), ["P-1005", "P-1006"]);
  assert.deepEqual(trace.evidence, [1, 2, 3]);
});

test("未知放行编号返回空", async () => {
  const [network, eventsDoc] = await Promise.all([loadNetwork(), loadEvents()]);
  assert.equal(traceRelease(network, eventsDoc.events, "REL-0000"), null);
});
