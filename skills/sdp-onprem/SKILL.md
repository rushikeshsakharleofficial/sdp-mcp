---
name: sdp-onprem
description: Work safely with the Web Werks on-premises ServiceDesk Plus v3 MCP, including request lookup, conversations, notes, and verified technician/group reassignment.
---

# ServiceDesk Plus on-premises

Use this skill for `https://assist.webwerks.in` and other on-premises SDP v3 tasks. Do not apply SDP Cloud-specific OAuth routes or payload examples without verifying them against the target instance.

## Read requests

- For a technician's queue, call `list_requests` with `list_info.search_criteria` using `technician.email_id` and paginate from `start_index` when `has_more_rows` is true.
- Use `get_request` before any mutation. Record the current technician and group so the original state can be restored if requested.
- To explain a ticket, use `sdp_call` with `GET requests/{request_id}/conversations`. Each conversation exposes a `content_url`; fetch it with `GET` to read its message body. Use `list_request_notes` followed by `get_request_note` for each note's text. Notes can be internal when `show_to_requester` is false.

## Write requests

Require explicit user approval immediately before a write. For a temporary live test, make the change, verify it with `get_request`, then restore the recorded state and verify restoration. Stop and report if either verification fails.

- SDP v3 writes use a form-encoded request body containing `input_data`, not a JSON request body or a query-string write payload.
- Authenticate with `authtoken`; this MCP also supplies `TECHNICIAN_KEY` for compatibility.
- Assign by updating the request, not by using `requests/{id}/assign` or `unassign`. Supply both objects:

```json
{
  "request": {
    "technician": { "id": "TECHNICIAN_ID", "name": "Technician Name" },
    "group": { "id": "GROUP_ID", "name": "Group Name", "site": null }
  }
}
```

Use `assign_request` with those two objects. Get a technician through `list_users` (filter by name or email, and confirm `is_technician: true`); this account may not have permission for the `technicians` endpoint.

## Diagnostics

- Preserve the full SDP HTTP status and response message when a tool errors.
- If HTTPS fails with an internal CA, configure `NODE_EXTRA_CA_CERTS`; never bypass certificate verification.
- For an undocumented route or payload, use `sdp_call` with `GET` first. Do not speculate with writes to an existing ticket.
