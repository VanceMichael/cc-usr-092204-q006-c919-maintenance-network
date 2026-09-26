import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { loadContext, loadNetwork } from "./catalog.js";
import { siteCapabilityReport } from "./effectivity.js";
import { traceRelease } from "./traceability.js";

export function createApp() {
  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const send = (status, body) => {
      response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(body));
    };

    if (url.pathname === "/health") return send(200, { status: "ok" });
    if (url.pathname === "/context") return send(200, await loadContext());
    if (url.pathname === "/capabilities") {
      const network = await loadNetwork();
      return send(200, siteCapabilityReport(network, url.searchParams.get("at") ?? "2026-09-26"));
    }
    const traceMatch = url.pathname.match(/^\/releases\/([^/]+)\/trace$/);
    if (traceMatch) {
      const network = await loadNetwork();
      try {
        return send(200, traceRelease(network, traceMatch[1]));
      } catch {
        return send(404, { error: "放行记录不存在" });
      }
    }
    return send(404, { error: "not found" });
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  createApp().listen(8000, "127.0.0.1");
}
