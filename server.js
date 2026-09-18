import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const base = (process.env.SDP_BASE_URL || "").replace(/\/+$/, "");
const token = process.env.SDP_AUTHTOKEN || process.env.SDP_API_KEY || "";
const oauth = process.env.SDP_OAUTH_TOKEN || "";
if (!base) throw new Error("SDP_BASE_URL is required");
try { if (!["http:", "https:"].includes(new URL(base).protocol)) throw new Error(); } catch { throw new Error("SDP_BASE_URL must be an HTTP(S) URL"); }
if (!token && !oauth) throw new Error("Set SDP_API_KEY, SDP_AUTHTOKEN, or SDP_OAUTH_TOKEN");

const ID = z.union([z.number().int().nonnegative(), z.string().min(1).regex(/^[^/?#\\%]+$/)]);
const RECORD = z.record(z.string(), z.unknown());
const LIST = z.object({ search_criteria: z.union([RECORD, z.array(RECORD)]).optional(), row_count: z.number().int().positive().max(100).optional(), start_index: z.number().int().positive().optional(), sort_field: z.string().optional(), sort_order: z.enum(["asc", "desc"]).optional(), get_total_count: z.boolean().optional(), fields_required: z.array(z.string()).optional() }).optional();
const listParams = (list) => list ? { input_data: JSON.stringify({ list_info: list }) } : {};
const requestPath = (id) => "requests/" + id;

async function sdp(method, endpoint, params = {}, body) {
  const path = endpoint.replace(/^\/+/, "");
  if (!path || path.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("API endpoint must be a non-empty path without dot segments");
  const url = new URL(base + "/api/v3/" + path.split("/").map(encodeURIComponent).join("/"));
  for (const [key, value] of Object.entries(params)) if (value != null && value !== "") url.searchParams.append(key, value);
  if (method === "GET" && body !== undefined) url.searchParams.set("input_data", JSON.stringify(body));
  const headers = { Accept: "application/vnd.manageengine.sdp.v3+json", "Content-Type": "application/x-www-form-urlencoded" };
  if (oauth) { headers.Authorization = "Bearer " + oauth; if (process.env.SDP_EMAIL) headers.USER = process.env.SDP_EMAIL; } else { headers.authtoken = token; headers.TECHNICIAN_KEY = token; }
  const init = { method, headers };
  if (method !== "GET" && body !== undefined) init.body = new URLSearchParams({ input_data: JSON.stringify(body) });
  const response = await fetch(url, init), text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) throw new Error("SDP " + method + " " + endpoint + " -> " + response.status + ": " + JSON.stringify(data));
  return data;
}
const server = new McpServer({ name: "imdc-sdp", version: "2.0.0" });
function tool(name, title, description, inputSchema, handler) {
  server.registerTool(name, { title, description, inputSchema }, async (args) => {
    try { return { content: [{ type: "text", text: JSON.stringify(await handler(args), null, 2) }] }; }
    catch (error) { return { isError: true, content: [{ type: "text", text: error.message }] }; }
  });
}
const idSchema = (key) => ({ [key]: ID });
tool("sdp_call", "Generic SDP API Call", "Call any SDP v3 endpoint. Write bodies are form-encoded as input_data.", { method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]), endpoint: z.string(), params: RECORD.optional(), body: z.any().optional() }, (a) => sdp(a.method, a.endpoint, a.params || {}, a.body));

tool("list_requests", "List Requests", "List requests.", { list_info: LIST }, (a) => sdp("GET", "requests", listParams(a.list_info)));
tool("get_request", "Get Request", "Get a request.", idSchema("request_id"), (a) => sdp("GET", requestPath(a.request_id)));
tool("create_request", "Create Request", "Create a request.", { body: RECORD }, (a) => sdp("POST", "requests", {}, { request: a.body }));
tool("update_request", "Update Request", "Update a request.", { request_id: ID, body: RECORD }, (a) => sdp("PUT", requestPath(a.request_id), {}, { request: a.body }));
tool("delete_request", "Delete Request", "Trash a request, or permanently delete it with force.", { request_id: ID, force: z.boolean().optional() }, (a) => sdp("DELETE", requestPath(a.request_id) + (a.force ? "" : "/move_to_trash")));
tool("restore_request", "Restore Request", "Restore a request from trash.", idSchema("request_id"), (a) => sdp("PUT", requestPath(a.request_id) + "/restore_from_trash", {}, 1));
tool("close_request", "Close Request", "Close with closure_info.", { request_id: ID, closure_info: RECORD }, (a) => sdp("PUT", requestPath(a.request_id) + "/close", {}, { request: { closure_info: a.closure_info } }));
tool("assign_request", "Assign Request", "Assign through the normal request update route; use technician and group objects from get_request.", { request_id: ID, technician: RECORD, group: RECORD }, (a) => sdp("PUT", requestPath(a.request_id), {}, { request: { technician: a.technician, group: a.group } }));
tool("pickup_request", "Pick Up Request", "Assign to the authenticated technician.", idSchema("request_id"), (a) => sdp("PUT", requestPath(a.request_id) + "/pickup", {}, 1));
tool("get_request_summary", "Get Request Summary", "Get request counts.", idSchema("request_id"), (a) => sdp("GET", requestPath(a.request_id) + "/summary"));
tool("get_request_resolution", "Get Request Resolution", "Get a resolution.", idSchema("request_id"), (a) => sdp("GET", requestPath(a.request_id) + "/resolutions"));
tool("add_request_resolution", "Add Request Resolution", "Add or update a resolution.", { request_id: ID, body: RECORD }, (a) => sdp("POST", requestPath(a.request_id) + "/resolutions", {}, { resolution: a.body }));

function nested(child, wrapper) {
  const singular = child.slice(0, -1);
  const path = (a) => requestPath(a.request_id) + "/" + child;
  tool("list_request_" + child, "List Request " + child, "List request " + child + ".", { request_id: ID, list_info: LIST }, (a) => sdp("GET", path(a), listParams(a.list_info)));
  tool("get_request_" + singular, "Get Request " + singular, "Get a request " + singular + ".", { request_id: ID, [singular + "_id"]: ID }, (a) => sdp("GET", path(a) + "/" + a[singular + "_id"]));
  tool("add_request_" + singular, "Add Request " + singular, "Add a request " + singular + ".", { request_id: ID, body: RECORD }, (a) => sdp("POST", path(a), {}, { [wrapper]: a.body }));
  tool("update_request_" + singular, "Update Request " + singular, "Update a request " + singular + ".", { request_id: ID, [singular + "_id"]: ID, body: RECORD }, (a) => sdp("PUT", path(a) + "/" + a[singular + "_id"], {}, { [wrapper]: a.body }));
  tool("delete_request_" + singular, "Delete Request " + singular, "Delete a request " + singular + ".", { request_id: ID, [singular + "_id"]: ID }, (a) => sdp("DELETE", path(a) + "/" + a[singular + "_id"]));
}
nested("notes", "note"); nested("tasks", "task");

function crud(singular, plural) {
  const id = singular + "_id";
  tool("list_" + plural, "List " + plural, "List " + plural + ".", { list_info: LIST }, (a) => sdp("GET", plural, listParams(a.list_info)));
  tool("get_" + singular, "Get " + singular, "Get a " + singular + ".", idSchema(id), (a) => sdp("GET", plural + "/" + a[id]));
  tool("create_" + singular, "Create " + singular, "Create a " + singular + ".", { body: RECORD }, (a) => sdp("POST", plural, {}, { [singular]: a.body }));
  tool("update_" + singular, "Update " + singular, "Update a " + singular + ".", { [id]: ID, body: RECORD }, (a) => sdp("PUT", plural + "/" + a[id], {}, { [singular]: a.body }));
  tool("delete_" + singular, "Delete " + singular, "Delete a " + singular + ".", idSchema(id), (a) => sdp("DELETE", plural + "/" + a[id]));
}
crud("change", "changes"); crud("project", "projects"); crud("task", "tasks"); crud("user", "users");
tool("trash_change", "Trash Change", "Move a change to trash.", idSchema("change_id"), (a) => sdp("DELETE", "changes/" + a.change_id + "/move_to_trash"));
tool("restore_change", "Restore Change", "Restore a change from trash.", idSchema("change_id"), (a) => sdp("PUT", "changes/" + a.change_id + "/restore_from_trash", {}, ""));
await server.connect(new StdioServerTransport());
