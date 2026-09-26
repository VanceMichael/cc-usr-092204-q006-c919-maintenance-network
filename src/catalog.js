import { readFile } from "node:fs/promises";

const FIXTURES = new URL("../fixtures/", import.meta.url);

async function loadFixture(name) {
  return JSON.parse(await readFile(new URL(name, FIXTURES), "utf8"));
}

export async function loadContext(path) {
  return path ? JSON.parse(await readFile(path, "utf8")) : loadFixture("context.json");
}

// 汇总全部领域资料，供各规则模块在同一份事实集上运算
export async function loadNetwork() {
  const [sites, fleet, maintenance, resources, operations] = await Promise.all([
    loadFixture("sites.json"),
    loadFixture("fleet.json"),
    loadFixture("maintenance.json"),
    loadFixture("resources.json"),
    loadFixture("operations.json"),
  ]);
  return {
    sites: sites.sites,
    policies: sites.policies,
    aircraft: fleet.aircraft,
    programs: maintenance.programs,
    workcards: maintenance.workcards,
    directives: maintenance.directives,
    tools: resources.tools,
    personnel: resources.personnel,
    components: resources.components,
    flights: operations.flights,
    releases: operations.releases,
    initialPositions: operations.initialPositions,
    movements: operations.movements,
    auditEvents: operations.auditEvents,
  };
}
