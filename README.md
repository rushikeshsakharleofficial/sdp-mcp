# sdp-mcp

Model Context Protocol (MCP) server for **ManageEngine ServiceDesk Plus (SDP)** v3 REST API.

Exposes tickets, tasks, changes, assets, users, technicians, knowledge-base articles, contracts and reference data as MCP tools, so LLM agents can query and operate a ServiceDesk Plus instance conversationally.

![MCP](https://img.shields.io/badge/MCP-Server-4a78bf) ![Node](https://img.shields.io/badge/node-%3E%3D18-green) [![npm](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

## Features

- Full **ticket (request) lifecycle**: list, get, create, update, close, trash/force-delete, restore, assign/unassign, hold/unhold, stats, PPM, linked change.
- Request sub-resources: conversations, notes, tasks, worklogs, assets, followers, **dynamics** (custom fields), resolution.
- **Change management**: list, get, create, update; change tasks, notes, trash/delete and CAB approve/reject.
- **Problem management**: full CRUD plus problem notes, tasks, worklogs and request↔problem linking.
- **Projects**: full CRUD plus milestones, tasks, comments and request↔project linking.
- **Standalone tasks** (not tied to a request): list, get, create, update, delete, and task worklogs.
- **Asset inventory**: list, get, create, update, trash/delete, asset types and picklist values.
- **People**: technicians, users, **requesters** (create/update), with filtering/pagination via `list_info`.
- **Reference data**: locations, departments, organizations, companies, vendors, request/task/recurring templates.
- **Knowledge base**: list/get/create solutions (KB articles).
- **Contracts**: list/get.
- **Derived groups**: many SDP instances lack a native `/groups` endpoint — this server scrapes groups referenced by change/task records instead.
- **`sdp_call` generic passthrough**: hits *any* `/api/v3/...` endpoint, so tools not yet wrapped are still reachable.

## Requirements

- Node.js **18+** (uses global `fetch` and ESM `import`).
- A ServiceDesk Plus instance reachable over HTTPS.

## Installation

```bash
git clone https://github.com/rushikeshsakharleofficial/sdp-mcp.git
cd sdp-mcp
npm install
```

## Configuration

Every credential comes from environment variables — nothing is hardcoded. Copy `.env.example` for the reference layout.

| Variable | Required | Description |
|---|---|---|
| `SDP_BASE_URL` | yes | Base URL of the SDP instance, e.g. `https://assist.example.com`. Defaults to `https://assist.webwerks.in`. |
| `SDP_API_KEY` | one of | Technician API key. When set, requests send the `TECHNICIAN_KEY` header. |
| `SDP_OAUTH_TOKEN` | one of | OAuth/Delegated token. When set, requests send `Authorization: Bearer <token>`. |
| `SDP_EMAIL` | with OAuth | Technician email; sent as the `USER` header in OAuth mode. |
| `NODE_EXTRA_CA_CERTS` | no | Path to a CA bundle (`proxy-ca.pem`) when SDP sits behind a proxy with a private CA. |

**Auth priority:** OAuth token wins; otherwise the API key is used.

### SDP API key

Generate a key in ServiceDesk Plus → **Admin → Technicians → *your tech* → API Keys**. The key must belong to a technician with permission for the resources the agent will touch.

### OAuth (delegated)

1. Register your app and get a client credential pair in SDP Admin.
2. Exchange for a token and supply it via `SDP_OAUTH_TOKEN`, with `SDP_EMAIL` as the acting technician.

Both modes authenticate the *technician*, so list/create/update operations observe that technician's SDP permissions.

## Usage

### Run standalone (stdio)

```bash
SDP_BASE_URL=https://assist.example.com SDP_API_KEY=your-key node server.js
```

The server speaks the MCP protocol over standard input/output (`StdioServerTransport`). Point any MCP-compatible client at it.

### opencode

Add to `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "mcp": {
    "sdp": {
      "type": "local",
      "command": ["node", "/path/to/sdp-mcp/server.js"],
      "enabled": true,
      "environment": {
        "SDP_BASE_URL": "https://assist.example.com",
        "SDP_API_KEY": "your-key"
      }
    }
  }
}
```

### Claude Desktop

```json
{
  "mcpServers": {
    "sdp": {
      "command": "node",
      "args": ["/path/to/sdp-mcp/server.js"],
      "env": {
        "SDP_BASE_URL": "https://assist.example.com",
        "SDP_API_KEY": "your-key"
      }
    }
  }
}
```

### Other MCP clients

Any client that can launch a local stdio process and feed it environment variables works the same way: run `node server.js` with `SDP_BASE_URL` and one auth credential set.

## Tools

### Tickets (requests)

| Tool | Description |
|---|---|
| `list_requests` | List tickets (default page). |
| `get_request` | Full ticket detail: technician, group, requester, category, subcategory, item, priority, dynamics, time entries. |
| `create_request` | Create a ticket (`subject`, `description`, `requester.email_id`, `priority`, `category`, `subcategory`, `item`, `technician`, `group`). |
| `update_request` | Edit a ticket: subject, description, priority, status, technician, group, category, `due_by_time`, etc. |
| `close_request` | Close a ticket with resolution, closure code, comment, time spent. |
| `delete_request` | Trash a ticket, or permanent delete with `force: true`. |
| `restore_request` | Restore from trash. |
| `assign_request` | Assign to a technician. |
| `unassign_request` | Remove the assigned technician. |
| `hold_request` / `unhold_request` | Set / clear hold state. |
| `get_request_stats` | Ticket completion stats. |
| `get_request_change` | Change record linked to the ticket. |
| `get_request_ppm` | Ticket budget/duration. |

### Conversations, notes, resolution

| Tool | Description |
|---|---|
| `list_request_conversations` / `add_request_conversation` | Conversations on a ticket. |
| `list_request_notes` / `get_request_note` / `add_request_note` / `update_request_note` / `delete_request_note` | Internal notes. |
| `get_request_resolution` | The public resolution record. |

### Request search & extras

| Tool | Description |
|---|---|
| `search_requests` | Search tickets by `list_info.search_criteria` (subject, status, requester, …). |
| `list_request_activities` | Audit/activity trail on a ticket. |
| `list_request_emails` | Emails associated with a ticket. |
| `list_request_links` / `add_request_link` | Linked requests. |

### Request tasks, worklogs, dynamics, followers, assets

| Tool | Description |
|---|---|
| `list_request_tasks` / `get_request_task` / `create_request_task` / `update_request_task` / `delete_request_task` | Tasks attached to a ticket. |
| `list_request_worklogs` / `add_request_worklog` / `update_request_worklog` / `delete_request_worklog` | Time / log entries on a ticket. |
| `list_task_worklogs` / `add_task_worklog` | Time / log entries on a task. |
| `get_request_dynamics` / `update_request_dynamics` | Custom (dynamic) field values. |
| `list_request_followers` / `add_request_follower` | Watchers. |
| `list_request_assets` / `associate_request_asset` / `dissociate_request_asset` | Asset linkage. |

### Tasks

| Tool | Description |
|---|---|
| `list_tasks` | Standalone tasks (paginate via `list_info`). |
| `get_task` | One general task. |
| `create_task` / `update_task` / `delete_task` | Standalone task lifecycle. |

### Changes

| Tool | Description |
|---|---|
| `list_changes` / `get_change` / `create_change` / `update_change` | Change requests (`create_change` requires `title`; accepts template, category, schedule, workflow, stage, status, tags, notes, etc.). |
| `list_change_tasks` / `get_change_task` / `add_change_task` / `update_change_task` / `delete_change_task` | Change tasks (`add_change_task` requires `title`, `stage`). |
| `list_change_notes` / `add_change_note` | Change notes. |
| `delete_change` | Trash a change, or permanent delete with `force: true`. |
| `approve_change` / `reject_change` | Approve / reject a change (CAB). |

### Problems

| Tool | Description |
|---|---|
| `list_problems` / `get_problem` / `create_problem` / `update_problem` / `delete_problem` | Problem records (CRUD). |
| `add_problem_note` / `add_problem_task` / `add_problem_worklog` | Problem notes, tasks, time entries. |
| `associate_problem` / `get_request_problem` / `dissociate_problem` | Link a problem to a ticket and back. |

### Projects

| Tool | Description |
|---|---|
| `list_projects` / `get_project` / `create_project` / `update_project` | Projects (CRUD). |
| `list_project_milestones` / `add_project_milestone` | Project milestones. |
| `list_project_tasks` / `get_project_task` / `add_project_task` | Project tasks. |
| `list_project_comments` / `add_project_comment` | Project comments. |
| `associate_project` / `get_request_project` / `dissociate_project` | Link a project to a ticket and back. |

### Assets

| Tool | Description |
|---|---|
| `list_assets` / `get_asset` / `create_asset` / `update_asset` / `delete_asset` | Asset inventory lifecycle. |
| `get_asset_picklist` | Picklist values for an asset type. |
| `list_asset_types` | Configured asset types. |

### People

| Tool | Description |
|---|---|
| `list_technicians` / `get_technician` | Technician accounts. |
| `list_users` / `get_user` / `create_user` / `update_user` | Users (filter by `search_criteria`, e.g. `{type, is, Technician}`). |
| `list_requesters` / `get_requester` / `create_requester` | Requesters (end users who raise tickets). |

### Reference data

| Tool | Description |
|---|---|
| `list_locations` | Sites/locations. |
| `list_departments` | Departments. |
| `list_organizations` | Organizations. |
| `list_companies` | Companies. |
| `list_vendors` / `get_vendor` | Vendors. |
| `list_request_templates` / `list_task_templates` / `list_recurring_templates` | Templates. |
| `list_solutions` / `get_solution` / `create_solution` / `update_solution` / `delete_solution` | Knowledge base articles. |
| `list_contracts` / `get_contract` | Contracts. |

### Groups (derived)

| Tool | Description |
|---|---|
| `list_groups` | Groups referenced by change and task records. See [notes](#known-limitations). |

### Anything else

| Tool | Description |
|---|---|
| `sdp_call` | Raw passthrough: `method` + `endpoint` (path after `/api/v3/`) + optional `params` / `body`. `body` is sent as the `input_data` query parameter for non-GET calls. Covers any endpoint, present or future. |

## API conventions

- All requests hit `/api/v3/<endpoint>` on `SDP_BASE_URL`.
- This SDP instance does **not** accept JSON request bodies — mutation payloads are serialized into the `input_data` query parameter (matching the v3 web-interface behavior). The server handles this automatically.
- Errors are returned as MCP error content with `HTTP status` + server payload.
- Non-JSON responses fall back to `{ raw: <text> }`.

## Known limitations

These are behaviors observed on the source instance (`assist.webwerks.in`); your tenancy may differ.

- **No query filters on `list_requests`** — the instance rejects filter parameters; only `get_request` returns full detail.
- **`/comments` returns 404** — use `list_request_conversations` / `add_request_conversation` instead.
- **No native `/groups` endpoint** — `list_groups` derives groups by scanning change/task records (up to 50 pages of 100 each). If your instance exposes `/groups`, replace `derivedGroups()` with a direct call.
- **`search_requests`** depends on tenancy — some SDP servers reject `search_criteria` on `GET /requests`; `list_requests` (unfiltered) is the safe fallback.
- **`approve_change` / `reject_change`** follow the documented `{change:{approve:...}}` shape but submit direction varies across instances — if they fail, use `sdp_call` with the raw endpoint.
- **`assign_request` payload encoding** is instance-specific; simplest is to copy a technician object obtained from `get_request`.

## Development

```bash
npm run start     # node server.js
```

Edit `server.js` — every tool is registered in ~80 lines via the `reg()` helper.

## License

MIT