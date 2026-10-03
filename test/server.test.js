import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const environment = (overrides = {}) => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("SDP_") && !["NODE_OPTIONS", "NODE_EXTRA_CA_CERTS"].includes(key))),
  SDP_API_KEY: "test-key", ...overrides,
});
const text = (result) => result.content[0].text;

async function setup(t, handler, overrides = {}) {
  const received = [];
  const api = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const entry = { method: request.method, url: request.url, headers: request.headers, body };
      received.push(entry);
      response.setHeader("Content-Type", "application/json");
      if (handler) handler(entry, response);
      else response.end(JSON.stringify({ response_status: { status: "success", status_code: 2000 } }));
    });
  });
  t.after(() => { api.closeAllConnections(); return new Promise((resolve) => api.close(resolve)); });
  await new Promise((resolve, reject) => { api.once("error", reject); api.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${api.address().port}`;
  const transport = new StdioClientTransport({ command: process.execPath, args: ["server.js"], cwd: root, env: environment({ SDP_BASE_URL: base, ...overrides }), stderr: "pipe" });
  const client = new Client({ name: "test", version: "1" });
  t.after(() => client.close());
  await client.connect(transport);
  return { client, received, base, call: (name, args = {}, options) => client.callTool({ name, arguments: args }, undefined, options) };
}

test("rejects invalid paths, IDs, and query values before contacting SDP", { timeout: 10000 }, async (t) => {
  const { call, received } = await setup(t);
  for (const endpoint of ["", "../users", "requests/../users", "requests//1", "requests/%2e%2e/users", "requests?x=1", "requests#x", "requests\\1", "requests/ 1"]) {
    const result = await call("sdp_call", { method: "GET", endpoint });
    assert.equal(result.isError, true, endpoint);
  }
  for (const request_id of [".", "..", " ", "abc", "0", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await call("get_request", { request_id })).isError, true, String(request_id));
  }
  assert.equal((await call("sdp_call", { method: "GET", endpoint: "requests", params: { x: {} } })).isError, true);
  assert.equal(received.length, 0);
  assert.notEqual((await call("get_request", { request_id: "9007199254740993" })).isError, true);
});

test("all dedicated tools register and use the expected routes and payloads", { timeout: 15000 }, async (t) => {
  const { call, client, received } = await setup(t);
  const rows = [
    ["list_requests", {}, "GET", "requests"],
    ["get_request", { request_id: "1" }, "GET", "requests/1"],
    ["create_request", { body: { subject: "test" } }, "POST", "requests", { request: { subject: "test" } }],
    ["update_request", { request_id: "1", body: {} }, "PUT", "requests/1", { request: {} }],
    ["delete_request", { request_id: "1" }, "DELETE", "requests/1/move_to_trash"],
    ["restore_request", { request_id: "1" }, "PUT", "requests/1/restore_from_trash", 1],
    ["close_request", { request_id: "1", closure_info: {} }, "PUT", "requests/1/close", { request: { closure_info: {} } }],
    ["assign_request", { request_id: "1", technician: { id: "2" }, group: { id: "3" } }, "PUT", "requests/1", { request: { technician: { id: "2" }, group: { id: "3" } } }],
    ["save_request_draft", { request_id: "1", to: ["to@example.com"], cc: ["cc@example.com"], bcc: ["bcc@example.com"], subject: "test", description: "<p>test</p>" }, "POST", "requests/1/drafts", { draft: { description: "<p>test</p>", subject: "test", content_type: "text/html", type: "reply", to: [{ email_id: "to@example.com" }], cc: [{ email_id: "cc@example.com" }], bcc: [{ email_id: "bcc@example.com" }] } }],
    ["pickup_request", { request_id: "1" }, "PUT", "requests/1/pickup", 1],
    ["get_request_summary", { request_id: "1" }, "GET", "requests/1/summary"],
    ["get_request_resolution", { request_id: "1" }, "GET", "requests/1/resolutions"],
    ["add_request_resolution", { request_id: "1", body: {} }, "POST", "requests/1/resolutions", { resolution: {} }],
    ["trash_change", { change_id: "1" }, "DELETE", "changes/1/move_to_trash"],
    ["restore_change", { change_id: "1" }, "PUT", "changes/1/restore_from_trash", ""],
  ];
  for (const [singular, plural, prefix] of [["note", "notes", "requests/1/"], ["task", "tasks", "requests/1/"], ["change", "changes", ""], ["project", "projects", ""], ["task", "tasks", ""], ["user", "users", ""]]) {
    const name = prefix ? "request_" : "";
    const args = prefix ? { request_id: "1" } : {};
    rows.push(
      [`list_${name}${plural}`, args, "GET", prefix + plural],
      [`get_${name}${singular}`, { ...args, [`${singular}_id`]: "2" }, "GET", prefix + plural + "/2"],
      [`${prefix ? "add" : "create"}_${name}${singular}`, { ...args, body: {} }, "POST", prefix + plural, { [singular]: {} }],
      [`update_${name}${singular}`, { ...args, [`${singular}_id`]: "2", body: {} }, "PUT", prefix + plural + "/2", { [singular]: {} }],
      [`delete_${name}${singular}`, { ...args, [`${singular}_id`]: "2" }, "DELETE", prefix + plural + "/2"],
    );
  }
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), [...rows.map(([name]) => name), "sdp_call"].sort());
  for (const [name, args, method, path, body] of rows) {
    assert.notEqual((await call(name, args)).isError, true, name);
    const entry = received.at(-1);
    assert.equal(entry.method, method, name);
    assert.equal(entry.url, "/api/v3/" + path, name);
    assert.equal(entry.headers.authtoken, "test-key");
    assert.equal(entry.headers.technician_key, "test-key");
    assert.equal(entry.headers.accept, "application/vnd.manageengine.sdp.v3+json");
    assert.equal(entry.headers["content-type"], "application/x-www-form-urlencoded");
    assert.equal(new URLSearchParams(entry.body).get("input_data"), body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body), name);
  }
  await call("delete_request", { request_id: "1", force: true });
  assert.equal(received.at(-1).url, "/api/v3/requests/1");
});

test("preserves context paths, pagination, OAuth, and generic request formats", { timeout: 10000 }, async (t) => {
  const { call, received } = await setup(t, undefined, { SDP_OAUTH_TOKEN: "test-oauth", SDP_EMAIL: "tech@example.com" });
  await call("list_requests", { list_info: { start_index: 2, row_count: 100, fields_required: ["id"], search_criteria: { field: "status.name", value: "Open" } } });
  assert.equal(JSON.parse(new URL(received.at(-1).url, "http://example.com").searchParams.get("input_data")).list_info.start_index, 2);
  assert.equal(received.at(-1).headers.authorization, "Bearer test-oauth");
  assert.equal(received.at(-1).headers.user, "tech@example.com");
  assert.equal(received.at(-1).headers.authtoken, undefined);
  await call("sdp_call", { method: "GET", endpoint: "requests", params: { zero: 0, flag: false, absent: null, empty: "" }, body: { list_info: { row_count: 1 } } });
  const query = new URL(received.at(-1).url, "http://example.com").searchParams;
  assert.equal(query.get("zero"), "0");
  assert.equal(query.get("flag"), "false");
  assert.equal(query.has("absent"), false);
  assert.equal(query.get("input_data"), '{"list_info":{"row_count":1}}');
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    await call("sdp_call", { method, endpoint: "requests/1", body: { request: {} } });
    assert.equal(received.at(-1).method, method);
    assert.equal(new URLSearchParams(received.at(-1).body).get("input_data"), '{"request":{}}');
  }
  const context = await setup(t, undefined);
  const nested = await setup(t, undefined, { SDP_BASE_URL: context.base + "/helpdesk/" });
  await nested.call("get_request", { request_id: "1" });
  assert.equal(context.received.at(-1).url, "/helpdesk/api/v3/requests/1");
});

test("detects HTTP and SDP failures, malformed responses, and empty success", { timeout: 10000 }, async (t) => {
  const responses = [
    [403, { message: "Permission denied" }],
    [200, { response_status: { status: "failed", status_code: 4000 } }],
    [200, { response_status: [{ status: "success", status_code: 2000 }, { status: "failed", status_code: 4001 }] }],
    [200, { response_status: { status_code: 5000 } }],
    [200, "<html>login</html>"], [204, ""],
  ];
  const { call } = await setup(t, (_, response) => {
    const [code, data] = responses.shift();
    response.statusCode = code;
    response.end(typeof data === "string" ? data : JSON.stringify(data));
  });
  for (let i = 0; i < 5; i++) assert.equal((await call("get_request", { request_id: "1" })).isError, true);
  assert.notEqual((await call("get_request", { request_id: "1" })).isError, true);
});

test("redacts configured credentials from successes and errors", { timeout: 10000 }, async (t) => {
  const secret = "dummy+a/b";
  const { call } = await setup(t, (_, response) => response.end(JSON.stringify({ response_status: { status: "failed" }, message: [secret, encodeURIComponent(secret), "test-oauth"] })), { SDP_API_KEY: secret, SDP_OAUTH_TOKEN: "test-oauth" });
  const result = await call("get_request", { request_id: "1" });
  assert.equal(result.isError, true);
  assert.doesNotMatch(text(result), /dummy|test-oauth/);
  assert.match(text(result), /REDACTED/);
  const success = await setup(t, (_, response) => response.end(JSON.stringify({ echoed: "test-key" })));
  assert.equal(JSON.parse(text(await success.call("get_request", { request_id: "1" }))).echoed, "[REDACTED]");
});

test("does not follow redirects or leak credentials to their destination", { timeout: 10000 }, async (t) => {
  const target = await setup(t);
  const source = await setup(t, (_, response) => { response.writeHead(302, { Location: target.base + "/stolen" }); response.end(); });
  assert.equal((await source.call("get_request", { request_id: "1" })).isError, true);
  assert.equal(target.received.length, 0);
});

test("times out stalled calls and allows subsequent calls", { timeout: 10000 }, async (t) => {
  let count = 0;
  const { call } = await setup(t, (_, response) => { if (++count > 1) response.end('{}'); }, { SDP_TIMEOUT_MS: "150" });
  const result = await call("get_request", { request_id: "1" });
  assert.equal(result.isError, true);
  assert.match(text(result), /timeout|timed out/i);
  assert.notEqual((await call("get_request", { request_id: "1" })).isError, true);
});

test("MCP cancellation aborts the upstream request", { timeout: 10000 }, async (t) => {
  let started, closed;
  const start = new Promise((resolve) => { started = resolve; });
  const close = new Promise((resolve) => { closed = resolve; });
  const { call } = await setup(t, (_, response) => { response.once("close", closed); started(); });
  const controller = new AbortController();
  const pending = call("get_request", { request_id: "1" }, { signal: controller.signal });
  const rejection = assert.rejects(pending);
  await start;
  controller.abort();
  await rejection;
  await close;
});

test("rejects invalid startup settings without connecting", { timeout: 10000 }, async () => {
  for (const overrides of [
    { SDP_BASE_URL: "https://example.com?x=1" }, { SDP_BASE_URL: "https://example.com#x" },
    { SDP_BASE_URL: "ftp://example.com" }, { SDP_BASE_URL: "" },
    { SDP_BASE_URL: "https://example.com", SDP_TIMEOUT_MS: "0" },
    { SDP_BASE_URL: "https://example.com", SDP_TIMEOUT_MS: "bad" },
    { SDP_BASE_URL: "https://example.com", SDP_API_KEY: "" },
  ]) {
    const child = spawn(process.execPath, ["server.js"], { cwd: root, env: environment(overrides), stdio: ["pipe", "pipe", "pipe"] });
    try {
      const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
      assert.notEqual(code, 0);
    } finally { child.kill(); }
  }
});
