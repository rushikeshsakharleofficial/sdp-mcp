# sdp-mcp

MCP server for the ManageEngine ServiceDesk Plus v3 REST API.

## Configure

Requires Node.js 22 or newer. Keep credentials in a restricted environment file
(such as `~/.admin/.env`, mode 600), never in command arguments or committed files.

```sh
npm ci
# Set SDP_BASE_URL and one authentication variable in the client environment.
npm start
```

Set one authentication variable:

| Variable | Purpose |
|---|---|
| `SDP_AUTHTOKEN` | Native SDP v3 authtoken (preferred). |
| `SDP_API_KEY` | Backward-compatible alias; sent as both `authtoken` and `TECHNICIAN_KEY`. |
| `SDP_OAUTH_TOKEN` | OAuth bearer token. |
| `SDP_EMAIL` | Acting technician email for OAuth. |
| `SDP_TIMEOUT_MS` | Positive request timeout in milliseconds; default 30000. |

## Tools

Dedicated tools cover the following v3 routes; availability and permissions depend on the SDP version and tenant:

- Requests: list, get, create, update, close, assign, pickup, trash, restore, summary, resolution, notes, and tasks.
- Changes, projects, general tasks, and users: list, get, create, update, and delete.
- Change trash and restore.

`assign_request` uses `PUT /requests/{id}`, not the tenant-specific
`/assign` action. Provide both `technician` and `group` objects. The
group must belong to the target technician; do not reuse the request's current
group when handing off between L1 and L2. For example, Pramod Patil uses
`{ "id": "315", "name": "L2-Server Administrator", "site": null }` for
non-Webwerks sites.

`save_request_draft` saves an unsent public reply in the ticket's draft
panel. It requires the recipient addresses and HTML description, and never
sends the message.

## Every other endpoint

Use `sdp_call`. It accesses any path after `/api/v3/`; all write payloads
are sent as URL-encoded `input_data`. Object bodies are JSON-serialized; string
bodies are sent verbatim, including an empty string for change restoration.
Query parameters accept strings, numbers, booleans, and null (omitted).

The base URL may include a deployment context path, but must not include
credentials, a query, or a fragment. Dedicated IDs must be positive integers
(use strings for large IDs). API paths must not contain dot segments, percent
escapes, whitespace, backslashes, queries, or fragments.

Calls reject redirects, honor MCP cancellation, and time out without automatic
retries. A timed-out write may already have reached SDP; check its state before
retrying. HTTP errors, SDP failure statuses, and non-JSON responses are tool
errors. Configured authentication tokens are redacted from tool output.
For internal CAs, set `NODE_EXTRA_CA_CERTS`; do not disable TLS verification.

Example:

```json
{
  "method": "POST",
  "endpoint": "requests/123/conversations",
  "body": { "conversation": { "content": "Update", "is_public": true } }
}
```

## Development

```sh
npm test
```

The test suite uses isolated credentials and local mock servers to check MCP
registration, validation, wire formats, API failures, redirects, redaction,
timeouts, and cancellation. It does not verify live tenant permissions or writes.
