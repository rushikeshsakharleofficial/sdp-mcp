# sdp-mcp

MCP server for the ManageEngine ServiceDesk Plus v3 REST API.

## Configure

\`\`\`sh
npm install
SDP_BASE_URL=https://assist.example.com SDP_AUTHTOKEN=your-token npm start
\`\`\`

Set one authentication variable:

| Variable | Purpose |
|---|---|
| \`SDP_AUTHTOKEN\` | Native SDP v3 authtoken (preferred). |
| \`SDP_API_KEY\` | Backward-compatible alias; sent as both \`authtoken\` and \`TECHNICIAN_KEY\`. |
| \`SDP_OAUTH_TOKEN\` | OAuth bearer token. |
| \`SDP_EMAIL\` | Acting technician email for OAuth. |

## Tools

Dedicated tools use only documented v3 routes:

- Requests: list, get, create, update, close, assign, pickup, trash, restore, summary, resolution, notes, and tasks.
- Changes, projects, general tasks, and users: list, get, create, update, and delete.
- Change trash and restore.

\`assign_request\` uses \`PUT /requests/{id}\`, not the tenant-specific
\`/assign\` action. Provide both \`technician\` and \`group\` objects. The
group must belong to the target technician; do not reuse the request's current
group when handing off between L1 and L2. For example, Pramod Patil uses
\`{ "id": "315", "name": "L2-Server Administrator", "site": null }\` for
non-Webwerks sites.

\`save_request_draft\` saves an unsent public reply in the ticket's draft
panel. It requires the recipient addresses and HTML description, and never
sends the message.

## Every other endpoint

Use \`sdp_call\`. It accesses any path after \`/api/v3/\`; all write payloads
are sent as URL-encoded \`input_data\`, exactly as SDP v3 requires.

Example:

\`\`\json
{
  "method": "POST",
  "endpoint": "requests/123/conversations",
  "body": { "conversation": { "content": "Update", "is_public": true } }
}
\`\`\`

## Development

\`\`\`sh
npm test
\`\`\`

The test suite validates traversal rejection and the request wire format against
a local mock server.
