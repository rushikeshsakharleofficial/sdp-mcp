import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const SDP_BASE = process.env.SDP_BASE_URL || "https://assist.webwerks.in";
const SDP_API_KEY = process.env.SDP_API_KEY || "";
const SDP_EMAIL = process.env.SDP_EMAIL || "";
const SDP_OAUTH_TOKEN = process.env.SDP_OAUTH_TOKEN || "";

const ID = z.union([z.number(), z.string()]).describe("Numeric or string ID");
const RECORD = z.record(z.any());
const LIST_INFO = z
  .object({
    search_criteria: z.array(z.record(z.any())).optional(),
    row_count: z.number().optional(),
    start_index: z.number().optional(),
    sort_field: z.string().optional(),
    sort_order: z.enum(["asc", "desc"]).optional(),
    get_total_count: z.boolean().optional(),
  })
  .optional()
  .describe("list_info: {search_criteria, row_count, start_index, sort_field, sort_order, get_total_count}");
function listParams(list_info) {
  return list_info ? { input_data: JSON.stringify({ list_info }) } : {};
}

async function sdp(method, endpoint, params = {}, body = null) {
  const qs = { ...params };
  if (body !== null) {
    qs["input_data"] = JSON.stringify(body);
  }
  const url = new URL(`${SDP_BASE}/api/v3/${endpoint.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(qs || {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.append(k, v);
  }
  const headers = { "Content-Type": "application/json" };
  if (SDP_OAUTH_TOKEN) {
    headers["Authorization"] = `Bearer ${SDP_OAUTH_TOKEN}`;
    if (SDP_EMAIL) headers["USER"] = SDP_EMAIL;
  } else if (SDP_API_KEY) {
    headers["TECHNICIAN_KEY"] = SDP_API_KEY;
  }
  const res = await fetch(url, { method, headers });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(`SDP ${method} ${endpoint} -> ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

const server = new McpServer({ name: "imdc-sdp", version: "1.0.0" });

function reg(name, title, description, inputSchema, fn) {
  server.registerTool(
    name,
    { title, description, inputSchema },
    async (args) => {
      try {
        const out = await fn(args);
        return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    },
  );
}

// ---- Generic passthrough: covers ANY endpoint, present or future ----
reg(
  "sdp_call",
  "Generic API Call",
  "Raw passthrough to the ServiceDesk Plus v3 REST API. endpoint is the path after /api/v3/ (e.g. 'requests', 'requests/123/comments', 'changes', 'problems'). send_body: JSON string sent as the input_data query parameter on non-GET calls (this instance does not accept request bodies). Use for any endpoint without a dedicated tool.",
  {
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    endpoint: z.string().describe("Path after /api/v3/, e.g. 'requests/123'"),
    params: RECORD.optional(),
    body: RECORD.optional().describe("Object; serialized to input_data query param for non-GET"),
  },
  (a) => sdp(a.method, a.endpoint, a.params || {}, a.body ?? null),
);

// ---- Request lifecycle ----
reg(
  "list_requests",
  "List Requests",
  "List tickets. This instance accepts no query filters (server rejects them); returns the default page (has_more_rows + start_index in response). Use get_request for full detail.",
  {},
  () => sdp("GET", "requests"),
);

reg(
  "get_request",
  "Get Request",
  "Full ticket detail (technician, group, requester, category, subcategory, item, priority, dynamics, time_entries, etc.).",
  { request_id: ID },
  (a) => sdp("GET", `requests/${a.request_id}`),
);

reg(
  "create_request",
  "Create Request",
  "Create a new ticket. This tenant requires: subject, description, requester{email_id}, priority (string like 'S5'), category, subcategory, item, technician, group. Verified working string fields: priority, category, subcategory, item. group/technician need the encoding this instance accepts; simplest is to pass fields matching an existing ticket via get_request. Sent as input_data.",
  { body: RECORD.describe("Ticket fields (sent as request wrapper under input_data)") },
  (a) => sdp("POST", "requests", {}, { request: a.body }),
);

reg(
  "update_request",
  "Update Request",
  "Edit an existing ticket: subject, description, priority, status, technician, group, category, subcategory, item, due_by_time, etc.",
  { request_id: ID, body: RECORD.describe("Fields to change") },
  (a) => sdp("PUT", `requests/${a.request_id}`, {}, { request: a.body }),
);

reg(
  "close_request",
  "Close Request",
  "Close a ticket. Body: resolution{content,...}, closure_code, comment, time_spent.",
  { request_id: ID, body: RECORD.default({}) },
  (a) => sdp("POST", `requests/${a.request_id}/close`, {}, { request: a.body }),
);

reg(
  "delete_request",
  "Delete Request",
  "Move request to trash (default), or permanent delete if force=true.",
  { request_id: ID, force: z.boolean().optional() },
  (a) => (a.force ? sdp("DELETE", `requests/${a.request_id}/force`) : sdp("POST", `requests/${a.request_id}/trash`)),
);

reg(
  "restore_request",
  "Restore Request",
  "Restore a request from trash.",
  { request_id: ID },
  (a) => sdp("POST", `requests/${a.request_id}/restore`),
);

reg(
  "assign_request",
  "Assign Request",
  "Assign ticket to a technician.",
  { request_id: ID, technician: z.string(), body: RECORD.optional() },
  (a) => sdp("POST", `requests/${a.request_id}/assign`, {}, a.body ?? { request: { technician: { name: a.technician } } }),
);

reg(
  "unassign_request",
  "Unassign Request",
  "Remove assigned technician.",
  { request_id: ID },
  (a) => sdp("POST", `requests/${a.request_id}/unassign`),
);

reg(
  "hold_request",
  "Hold Request",
  "Place a ticket on hold.",
  { request_id: ID },
  (a) => sdp("POST", `requests/${a.request_id}/hold`),
);

reg(
  "unhold_request",
  "Unhold Request",
  "Take a ticket off hold.",
  { request_id: ID },
  (a) => sdp("POST", `requests/${a.request_id}/unhold`),
);

reg("get_request_stats", "Get Request Stats", "Ticket completion stats.", { request_id: ID }, (a) => sdp("GET", `requests/${a.request_id}/stats`));
reg("get_request_change", "Get Request Change", "Change linked to ticket.", { request_id: ID }, (a) => sdp("GET", `requests/${a.request_id}/change`));
reg("get_request_ppm", "Get Request PPM", "Budget/duration of ticket.", { request_id: ID }, (a) => sdp("GET", `requests/${a.request_id}/ppm`));

// ---- Request sub-resources ----
reg(
  "list_request_conversations",
  "List Request Conversations",
  "Conversations on a ticket (replaces /comments, which returns 404 on this instance).",
  { request_id: ID, list_info: LIST_INFO },
  (a) => sdp("GET", `requests/${a.request_id}/conversations`, listParams(a.list_info)),
);

reg(
  "add_request_conversation",
  "Add Request Conversation",
  "Add a conversation entry to a ticket. Body: {content, is_public, ...}.",
  { request_id: ID, body: RECORD.describe("Conversation fields") },
  (a) => sdp("POST", `requests/${a.request_id}/conversations`, {}, { conversation: a.body }),
);

reg(
  "list_request_assets",
  "List Request Assets",
  "Assets associated with a ticket.",
  { request_id: ID },
  (a) => sdp("GET", `requests/${a.request_id}/assets`),
);

reg(
  "associate_request_asset",
  "Associate Request Asset",
  "Associate an asset with a ticket.",
  { request_id: ID, body: RECORD.describe("e.g. {asset: {id: 123}}") },
  (a) => sdp("POST", `requests/${a.request_id}/assets`, {}, { request: a.body }),
);

reg(
  "dissociate_request_asset",
  "Dissociate Request Asset",
  "Remove an asset from a ticket.",
  { request_id: ID, asset_id: ID },
  (a) => sdp("DELETE", `requests/${a.request_id}/assets/${a.asset_id}`),
);

reg(
  "list_request_tasks",
  "List Request Tasks",
  "Tasks attached to a ticket.",
  { request_id: ID },
  (a) => sdp("GET", `requests/${a.request_id}/tasks`),
);

reg(
  "get_request_task",
  "Get Request Task",
  "One task on a ticket.",
  { request_id: ID, task_id: ID },
  (a) => sdp("GET", `requests/${a.request_id}/tasks/${a.task_id}`),
);

reg(
  "create_request_task",
  "Create Request Task",
  "Add a task. Body: subject, description, planned_start_time, planned_end_time, scheduled_time, duration, watchers.",
  { request_id: ID, body: RECORD.describe("Task fields") },
  (a) => sdp("POST", `requests/${a.request_id}/tasks`, {}, { task: a.body }),
);

reg(
  "update_request_task",
  "Update Request Task",
  "Edit a task.",
  { request_id: ID, task_id: ID, body: RECORD.describe("Task fields") },
  (a) => sdp("PUT", `requests/${a.request_id}/tasks/${a.task_id}`, {}, { task: a.body }),
);

reg(
  "delete_request_task",
  "Delete Request Task",
  "Remove a task.",
  { request_id: ID, task_id: ID },
  (a) => sdp("DELETE", `requests/${a.request_id}/tasks/${a.task_id}`),
);

reg(
  "get_request_dynamics",
  "Get Request Dynamics",
  "Dynamic (custom) field values.",
  { request_id: ID },
  (a) => sdp("GET", `requests/${a.request_id}/dynamics`),
);

reg(
  "update_request_dynamics",
  "Update Request Dynamics",
  "Update dynamic/custom fields.",
  { request_id: ID, body: RECORD.describe("Dynamic field values") },
  (a) => sdp("PUT", `requests/${a.request_id}/dynamics`, {}, { request: a.body }),
);

reg(
  "list_request_followers",
  "List Request Followers",
  "Users following a ticket.",
  { request_id: ID },
  (a) => sdp("GET", `requests/${a.request_id}/followers`),
);

reg(
  "add_request_follower",
  "Add Request Follower",
  "Add a follower.",
  { request_id: ID, body: RECORD.describe("e.g. {requester: {email_id: ...}}") },
  (a) => sdp("POST", `requests/${a.request_id}/followers`, {}, { request: a.body }),
);

// ---- Request notes ----
reg(
  "list_request_notes",
  "List Request Notes",
  "Notes on a ticket (internal notes).",
  { request_id: ID, list_info: LIST_INFO },
  (a) => sdp("GET", `requests/${a.request_id}/notes`, listParams(a.list_info)),
);

reg(
  "get_request_note",
  "Get Request Note",
  "One note on a ticket.",
  { request_id: ID, note_id: ID },
  (a) => sdp("GET", `requests/${a.request_id}/notes/${a.note_id}`),
);

reg(
  "add_request_note",
  "Add Request Note",
  "Add an internal note to a ticket. Body: description, show_to_requester, mark_first_response, add_to_linked_requests.",
  { request_id: ID, body: RECORD.describe("Note fields") },
  (a) => sdp("POST", `requests/${a.request_id}/notes`, {}, { note: a.body }),
);

reg(
  "update_request_note",
  "Update Request Note",
  "Edit a note on a ticket.",
  { request_id: ID, note_id: ID, body: RECORD.describe("Note fields") },
  (a) => sdp("PUT", `requests/${a.request_id}/notes/${a.note_id}`, {}, { note: a.body }),
);

reg(
  "delete_request_note",
  "Delete Request Note",
  "Delete a note from a ticket.",
  { request_id: ID, note_id: ID },
  (a) => sdp("DELETE", `requests/${a.request_id}/notes/${a.note_id}`),
);

reg(
  "get_request_resolution",
  "Get Request Resolution",
  "Resolution (public answer) on a ticket.",
  { request_id: ID },
  (a) => sdp("GET", `requests/${a.request_id}/resolutions`),
);

reg(
  "list_request_worklogs",
  "List Request Worklogs",
  "Time/log entries on a ticket.",
  { request_id: ID, list_info: LIST_INFO },
  (a) => sdp("GET", `requests/${a.request_id}/worklogs`, listParams(a.list_info)),
);

reg(
  "list_task_worklogs",
  "List Task Worklogs",
  "Time/log entries on a general task.",
  { task_id: ID, list_info: LIST_INFO },
  (a) => sdp("GET", `tasks/${a.task_id}/worklogs`, listParams(a.list_info)),
);

// ---- Templates & recurrence ----
reg("list_recurring_templates", "List Recurring Templates", "Recurring request templates.", {}, () => sdp("GET", "requests/recurring_templates"));
reg("list_request_templates", "List Request Templates", "Request templates.", {}, () => sdp("GET", "request_templates"));
reg("list_task_templates", "List Task Templates", "Task templates.", {}, () => sdp("GET", "task_templates"));

// ---- General tasks (standalone, across entities) ----
reg(
  "list_tasks",
  "List General Tasks",
  "General/standalone tasks (not tied to a request). Optional list_info for pagination.",
  { list_info: LIST_INFO },
  (a) => sdp("GET", "tasks", listParams(a.list_info)),
);
reg("get_task", "Get General Task", "One general task.", { task_id: ID }, (a) => sdp("GET", `tasks/${a.task_id}`));

// ---- Changes ----
reg(
  "list_changes",
  "List Changes",
  "List change requests. Optional list_info for pagination/filtering.",
  { list_info: LIST_INFO },
  (a) => sdp("GET", "changes", listParams(a.list_info)),
);
reg("get_change", "Get Change", "Change request detail.", { change_id: ID }, (a) => sdp("GET", `changes/${a.change_id}`));
reg(
  "create_change",
  "Create Change",
  "Create a change request. Mandatory: title. Body: title, template{id}, category{id}, subcategory{id}, item{id}, change_type{id}, change_manager{id}, change_owner{id}, priority{id}, impact{id}, urgency{id}, risk{id}, schedule{scheduled_start_time, scheduled_end_time}, workflow{id}, reason_for_change{id}, stage{id}, status{id}, description, tags, notes.",
  { body: RECORD.describe("Change fields") },
  (a) => sdp("POST", "changes", {}, { change: a.body }),
);
reg(
  "update_change",
  "Update Change",
  "Edit a change request.",
  { change_id: ID, body: RECORD.describe("Change fields") },
  (a) => sdp("PUT", `changes/${a.change_id}`, {}, { change: a.body }),
);

reg(
  "list_change_tasks",
  "List Change Tasks",
  "Tasks on a change.",
  { change_id: ID, list_info: LIST_INFO },
  (a) => sdp("GET", `changes/${a.change_id}/tasks`, listParams(a.list_info)),
);
reg(
  "get_change_task",
  "Get Change Task",
  "One task on a change.",
  { change_id: ID, task_id: ID },
  (a) => sdp("GET", `changes/${a.change_id}/tasks/${a.task_id}`),
);
reg(
  "add_change_task",
  "Add Change Task",
  "Add a task to a change. Mandatory: title, stage. Body: title, stage, description, planned_start_time{value}, planned_end_time{value}, scheduled_time, duration.",
  { change_id: ID, body: RECORD.describe("Task fields") },
  (a) => sdp("POST", `changes/${a.change_id}/tasks`, {}, { task: a.body }),
);
reg(
  "update_change_task",
  "Update Change Task",
  "Edit a change task.",
  { change_id: ID, task_id: ID, body: RECORD.describe("Task fields") },
  (a) => sdp("PUT", `changes/${a.change_id}/tasks/${a.task_id}`, {}, { task: a.body }),
);
reg(
  "delete_change_task",
  "Delete Change Task",
  "Remove a change task.",
  { change_id: ID, task_id: ID },
  (a) => sdp("DELETE", `changes/${a.change_id}/tasks/${a.task_id}`),
);

reg(
  "list_change_notes",
  "List Change Notes",
  "Notes on a change.",
  { change_id: ID, list_info: LIST_INFO },
  (a) => sdp("GET", `changes/${a.change_id}/notes`, listParams(a.list_info)),
);
reg(
  "add_change_note",
  "Add Change Note",
  "Add a note to a change. Body: description, show_to_requester.",
  { change_id: ID, body: RECORD.describe("Note fields") },
  (a) => sdp("POST", `changes/${a.change_id}/notes`, {}, { note: a.body }),
);

// ---- Assets ----
reg("list_assets", "List Assets", "Asset inventory (default page).", {}, () => sdp("GET", "assets"));
reg(
  "get_asset",
  "Get Asset",
  "Asset detail.",
  { asset_id: ID },
  (a) => sdp("GET", `assets/${a.asset_id}`),
);
reg(
  "create_asset",
  "Create Asset",
  "Create an asset. Body: name, asset_type, asset_tag, department, location, etc.",
  { body: RECORD.describe("Asset fields") },
  (a) => sdp("POST", "assets", {}, { asset: a.body }),
);
reg(
  "update_asset",
  "Update Asset",
  "Edit an asset.",
  { asset_id: ID, body: RECORD.describe("Asset fields") },
  (a) => sdp("PUT", `assets/${a.asset_id}`, {}, { asset: a.body }),
);
reg(
  "delete_asset",
  "Delete Asset",
  "Trash (default) or permanent delete if force=true.",
  { asset_id: ID, force: z.boolean().optional() },
  (a) => (a.force ? sdp("DELETE", `assets/${a.asset_id}/force`) : sdp("POST", `assets/${a.asset_id}/trash`)),
);
reg(
  "get_asset_picklist",
  "Get Asset Picklist",
  "Picklist values for an asset type.",
  { asset_type_id: z.number() },
  (a) => sdp("GET", `assets/picklist/${a.asset_type_id}`),
);

// ---- People ----
reg("list_technicians", "List Technicians", "Technician accounts (needs permission).", {}, () => sdp("GET", "technicians"));
reg("get_technician", "Get Technician", "Technician detail.", { technician_id: ID }, (a) => sdp("GET", `technicians/${a.technician_id}`));
reg(
  "list_users",
  "List Users",
  "All users. Optional list_info: {search_criteria:[{field:'type',condition:'is',value:'Technician'}], row_count, start_index} for filtering/pagination.",
  { list_info: LIST_INFO },
  (a) => sdp("GET", "users", listParams(a.list_info)),
);
reg("get_user", "Get User", "User detail.", { user_id: ID }, (a) => sdp("GET", `users/${a.user_id}`));
reg(
  "create_user",
  "Create User",
  "Create a user. Body: first_name, last_name, email_id, phone, job_title, password.",
  { body: RECORD.describe("User fields") },
  (a) => sdp("POST", "users", {}, { user: a.body }),
);
reg(
  "update_user",
  "Update User",
  "Edit a user.",
  { user_id: ID, body: RECORD.describe("User fields") },
  (a) => sdp("PUT", `users/${a.user_id}`, {}, { user: a.body }),
);

// ---- Reference data ----
reg("list_locations", "List Locations", "Sites/locations.", {}, () => sdp("GET", "locations"));
reg("list_departments", "List Departments", "Departments.", {}, () => sdp("GET", "departments"));
reg("list_organizations", "List Organizations", "Organizations.", {}, () => sdp("GET", "organizations"));
reg("list_companies", "List Companies", "Companies.", {}, () => sdp("GET", "companies"));
reg("list_vendors", "List Vendors", "Vendors.", {}, () => sdp("GET", "vendors"));
reg("get_vendor", "Get Vendor", "Vendor detail.", { vendor_id: ID }, (a) => sdp("GET", `vendors/${a.vendor_id}`));

// ---- Groups (derived) ----
// ponytail: this instance has no /groups endpoint, so groups are scraped from
// change/task records. Add a native source if SDP ever exposes one.
async function derivedGroups() {
  const seen = new Map();
  for (const entity of ["changes", "tasks"]) {
    let start = 1;
    for (let page = 0; page < 50; page++) {
      const data = await sdp("GET", entity, {
        input_data: JSON.stringify({ list_info: { row_count: 100, start_index: start } }),
      });
      const rows = data[entity] || [];
      for (const r of rows) {
        const g = r && r.group;
        if (g && g.id != null) {
          seen.set(String(g.id), {
            id: String(g.id),
            name: g.name || null,
            site: typeof g.site === "string" ? g.site : g.site && g.site.name ? g.site.name : g.site && g.site.id != null ? g.site.id : null,
          });
        }
      }
      const li = data.list_info || {};
      if (!li.has_more_rows || rows.length === 0) break;
      start = (li.start_index || start) + (li.row_count || rows.length);
    }
  }
  return [...seen.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}
reg(
  "list_groups",
  "List Groups",
  "All group objects referenced by changes and tasks. Derived from records; no native /groups API on this instance.",
  {},
  () => derivedGroups(),
);

// ---- Solutions (knowledge base) ----
reg("list_solutions", "List Solutions", "KB articles.", {}, () => sdp("GET", "solutions"));
reg("get_solution", "Get Solution", "KB article detail.", { solution_id: ID }, (a) => sdp("GET", `solutions/${a.solution_id}`));
reg(
  "create_solution",
  "Create Solution",
  "Create a KB article. Body: subject, description, solution_type, status, category.",
  { body: RECORD.describe("Solution fields") },
  (a) => sdp("POST", "solutions", {}, { solution: a.body }),
);

// ---- Contracts ----
reg("list_contracts", "List Contracts", "Contracts.", {}, () => sdp("GET", "contracts"));
reg("get_contract", "Get Contract", "Contract detail.", { contract_id: ID }, (a) => sdp("GET", `contracts/${a.contract_id}`));

const transport = new StdioServerTransport();
await server.connect(transport);