# imdc-sdp-mcp

MCP server for ManageEngine ServiceDesk Plus (SDP) v3 REST API. Exposes SDP
tickets, tasks, changes, assets, users, technicians and more as MCP tools.

## Setup

```bash
npm install
SDP_BASE_URL=... SDP_API_KEY=... node server.js
```

Auth is via `TECHNICIAN_KEY` header (API key) or `Bearer` token + `USER`
header (OAuth). All values come from environment variables — see
`.env.example`.

## Configuring opencode

```jsonc
{
  "mcp": {
    "sdp": {
      "type": "local",
      "command": ["node", "/path/to/imdc-sdp-mcp/server.js"],
      "enabled": true,
      "environment": {
        "SDP_BASE_URL": "https://assist.example.com",
        "SDP_API_KEY": "your-key"
      }
    }
  }
}
```

`NODE_EXTRA_CA_CERTS` may be needed if your SDP is behind a proxy with a
private CA.

## Run

```bash
node server.js
```

Communicates over stdio (StdioServerTransport).