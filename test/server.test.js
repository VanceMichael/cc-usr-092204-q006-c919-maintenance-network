import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server.js";

test("服务入口", async () => {
  const app = createApp();
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.address().port}`;

  const health = await fetch(`${base}/health`).then((response) => response.json());
  assert.equal(health.status, "ok");

  const context = await fetch(`${base}/context`).then((response) => response.json());
  assert.equal(context.project, "C919维修能力网络");

  const capabilities = await fetch(`${base}/capabilities`).then((response) => response.json());
  assert.ok(Array.isArray(capabilities));
  assert.ok(capabilities.some((row) => row.site === "GZ" && row.level === "深度定检" && row.available));

  const trace = await fetch(`${base}/releases/RL-2026-0001/trace`).then((response) => response.json());
  assert.equal(trace.ok, true);

  const missing = await fetch(`${base}/releases/RL-XXXX/trace`);
  assert.equal(missing.status, 404);

  await new Promise((resolve) => app.close(resolve));
});
