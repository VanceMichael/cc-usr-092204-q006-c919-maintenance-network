import { createServer } from "node:http";
import { loadContext, loadNetwork, loadEvents } from "./catalog.js";
import { suspensionImpact, effectiveCapabilities } from "./impact.js";
import { traceRelease } from "./trace.js";

const send = (response, data, status = 200) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");

  if (url.pathname === "/health") {
    return send(response, { status: "ok" });
  }
  if (url.pathname === "/context") {
    return send(response, await loadContext());
  }
  if (url.pathname === "/network") {
    return send(response, await loadNetwork());
  }
  if (url.pathname === "/events") {
    return send(response, await loadEvents());
  }
  // 能力暂停影响：/impact?site=GA2&capability=LINE&from=2026-09-26T10:00:00%2B08:00[&to=...]
  if (url.pathname === "/impact") {
    const network = await loadNetwork();
    const suspension = {
      site: url.searchParams.get("site"),
      capability: url.searchParams.get("capability"),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to") ?? undefined
    };
    return send(response, suspensionImpact(network, suspension));
  }
  // 各地真实可承接层级：/capabilities?at=2026-09-26T11:00:00%2B08:00
  if (url.pathname === "/capabilities") {
    const [network, eventsDoc] = await Promise.all([loadNetwork(), loadEvents()]);
    return send(response, effectiveCapabilities(network, eventsDoc.events, url.searchParams.get("at") ?? network.as_of));
  }
  // 放行追溯：/trace?release=REL-7001
  if (url.pathname === "/trace") {
    const [network, eventsDoc] = await Promise.all([loadNetwork(), loadEvents()]);
    const result = traceRelease(network, eventsDoc.events, url.searchParams.get("release"));
    return result ? send(response, result) : send(response, { error: "放行记录不存在" }, 404);
  }
  response.writeHead(404);
  response.end();
});

server.listen(8000, "127.0.0.1");
