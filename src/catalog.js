import { readFile } from "node:fs/promises";

const fixture = (name) => new URL(`../fixtures/${name}`, import.meta.url);

export async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function loadContext(path = fixture("context.json")) {
  return loadJson(path);
}

export async function loadNetwork(path = fixture("network.json")) {
  return loadJson(path);
}

export async function loadEvents(path = fixture("events.json")) {
  return loadJson(path);
}
