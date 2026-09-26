import test from "node:test";
import assert from "node:assert/strict";
import { loadJson, loadContext, loadNetwork, loadEvents } from "../src/catalog.js";
import { validateSchema } from "../src/schema.js";

const contract = (name) => new URL(`../contracts/${name}`, import.meta.url);

test("领域上下文符合契约", async () => {
  const [schema, data] = await Promise.all([loadJson(contract("context.schema.json")), loadContext()]);
  assert.deepEqual(validateSchema(schema, data), []);
});

test("网络快照符合契约", async () => {
  const [schema, data] = await Promise.all([loadJson(contract("network.schema.json")), loadNetwork()]);
  assert.deepEqual(validateSchema(schema, data), []);
});

test("审计事件流符合契约", async () => {
  const [schema, data] = await Promise.all([loadJson(contract("events.schema.json")), loadEvents()]);
  assert.deepEqual(validateSchema(schema, data), []);
});

test("契约校验能发现结构错误", async () => {
  const [schema, data] = await Promise.all([loadJson(contract("network.schema.json")), loadNetwork()]);
  const broken = structuredClone(data);
  broken.sites[0].capabilities.push({ code: "X_CHECK", status: "active" });
  const errors = validateSchema(schema, broken);
  assert.ok(errors.length > 0);
  assert.ok(errors.some((e) => e.includes("X_CHECK")));
});

test("事件契约能拒绝未知的处置决定", async () => {
  const [schema, data] = await Promise.all([loadJson(contract("events.schema.json")), loadEvents()]);
  const broken = structuredClone(data);
  broken.events.find((e) => e.type === "ad_disposition").decision = "hold";
  assert.ok(validateSchema(schema, broken).length > 0);
});
