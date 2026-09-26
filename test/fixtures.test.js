import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validate } from "../src/schema.js";
import { loadNetwork } from "../src/catalog.js";
import { verifyConservation } from "../src/conservation.js";

const CONTRACTS = new URL("../contracts/", import.meta.url);

async function loadSchema(name) {
  return JSON.parse(await readFile(new URL(`${name}.schema.json`, CONTRACTS), "utf8"));
}

test("样例数据符合交换契约", async () => {
  const network = await loadNetwork();
  const context = JSON.parse(await readFile(new URL("../fixtures/context.json", import.meta.url), "utf8"));

  const groups = [
    ["context", [context], "领域上下文"],
    ["site", network.sites, "站点"],
    ["policy", network.policies, "一地一策"],
    ["aircraft", network.aircraft, "飞机"],
    ["program", network.programs, "维修方案"],
    ["workcard", network.workcards, "工卡"],
    ["directive", network.directives, "适航指令"],
    ["tool", network.tools, "工具"],
    ["personnel", network.personnel, "人员"],
    ["component", network.components, "部件"],
    ["flight", network.flights, "航班计划"],
    ["release", network.releases, "放行记录"],
    ["movement", network.movements, "流转记录"],
  ];
  for (const [name, items, label] of groups) {
    const schema = await loadSchema(name);
    items.forEach((item, index) => {
      const result = validate(schema, item);
      assert.ok(result.ok, `${label}[${index}] ${result.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`);
    });
  }

  const eventSchema = await loadSchema("audit-event");
  for (const [site, events] of Object.entries(network.auditEvents)) {
    events.forEach((event, index) => {
      const result = validate(eventSchema, event);
      assert.ok(result.ok, `审计事件 ${site}[${index}] ${result.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`);
    });
  }
});

test("流转台账守恒且与资源台账一致", async () => {
  const network = await loadNetwork();
  const result = verifyConservation(network);
  assert.ok(result.balanced, JSON.stringify(result.discrepancies));

  // 部件台账位置与流转结果一致
  for (const component of network.components) {
    assert.equal(result.positions[component.serial], component.location, `${component.serial} 位置不一致`);
  }
  // 工具位置：借出/送校的以流转结果为准，其余在保管站点
  const moved = { "TL-006": "GZ", "TL-009": "CAL-01" };
  for (const tool of network.tools) {
    assert.equal(result.positions[tool.id], moved[tool.id] ?? tool.custodian, `${tool.id} 位置不一致`);
  }
  // 未闭环：一件借出、一件送校
  assert.deepEqual(result.outstanding.map((item) => item.item).sort(), ["TL-006", "TL-009"]);
});

test("站点策略引用的工卡修订都存在", async () => {
  const network = await loadNetwork();
  for (const policy of network.policies) {
    for (const [card, revision] of Object.entries(policy.workcardRevisions)) {
      assert.ok(
        network.workcards.some((item) => item.id === card && item.revision === revision),
        `${policy.site} 采用的 ${card} ${revision} 不存在`,
      );
    }
  }
});

test("机队规模与双基地事实", async () => {
  const network = await loadNetwork();
  assert.equal(network.aircraft.length, 12);
  assert.ok(network.sites.filter((site) => site.type === "主基地").length === 2);
  assert.ok(network.sites.filter((site) => site.type === "通航机场").length >= 3);
});
