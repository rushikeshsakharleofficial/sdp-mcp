import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

test("rejects endpoint traversal before making an API call", async () => {
  const child = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, SDP_BASE_URL: "https://sdp.example", SDP_API_KEY: "test-key" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const response = new Promise((resolve, reject) => {
    let pending = "";
    child.stdout.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        const message = JSON.parse(line);
        if (message.id === 2) resolve(message);
      }
    });
    child.on("error", reject);
    child.stderr.on("data", reject);
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "sdp_call", arguments: { method: "GET", endpoint: "../users" } } })}\n`);
  const result = await response.finally(() => child.kill());
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /without dot segments/);
});

test("sends v3 mutations as form-encoded input_data with an authtoken", async () => {
  let received;
  const api = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      received = { method: request.method, url: request.url, headers: request.headers, body };
      response.setHeader("Content-Type", "application/json");
      response.end('{"response_status":{"status":"success"}}');
    });
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const { port } = api.address();
  const child = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, SDP_BASE_URL: `http://127.0.0.1:${port}`, SDP_API_KEY: "test-key" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const response = new Promise((resolve, reject) => {
    let pending = "";
    child.stdout.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        const message = JSON.parse(line);
        if (message.id === 2) resolve(message);
      }
    });
    child.on("error", reject);
    child.stderr.on("data", reject);
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "sdp_call", arguments: { method: "POST", endpoint: "requests", body: { request: { subject: "Test" } } } } })}\n`);
  await response.finally(() => child.kill());
  await new Promise((resolve) => api.close(resolve));
  assert.equal(received.method, "POST");
  assert.equal(received.url, "/api/v3/requests");
  assert.equal(received.headers.authtoken, "test-key");
  assert.match(received.headers.accept, /application\/vnd\.manageengine\.sdp\.v3\+json/);
  assert.match(received.headers["content-type"], /application\/x-www-form-urlencoded/);
  assert.equal(new URLSearchParams(received.body).get("input_data"), '{"request":{"subject":"Test"}}');
});
