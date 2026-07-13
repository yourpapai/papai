# MCP Test Canary (coding agent)

> Plugin ID: `mcp-test` · Version: 1.0.0 · `defaultEnabled: false`

A trivial canary plugin that proves the `/mcp/plugin/<id>` → coding-agent path
is reachable. It declares `mcpServer: true`, so its single tool is exposed as
an MCP server surface at `/mcp/plugin/mcp-test` for an external coding agent
(via papai's sandbox MCP broker) to call directly. Useful as a quick,
low-stakes live probe after each deploy — no credentials, no upstream, no
side effects. It is the ninth and final first-party plugin migrated onto the
"MCP server as a papai plugin" pattern (see
`docs/architecture/coding-stack-overview.md` §3.6).

## Tools

| Tool   | Notes                                                               |
| ------ | ------------------------------------------------------------------- |
| `test` | No input. Returns the fixed string confirming the path is reachable |

## Permissions

None.

## Configuration

None.

## Response redaction

None — the plugin has no upstream and returns only a constant string, so
there is nothing to redact.

## Enabling

Approve the plugin in the settings UI admin Plugins area (super admin) and
enable it as an internal MCP server, then select `plugin:mcp-test` as a
coding MCP server for the context.
