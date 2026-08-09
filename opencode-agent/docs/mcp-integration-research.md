<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# MCP integration for the agent pipeline: what the pinned SDK offers, and where users should configure it

Research for issue #252: how a repository maintainer should be able to attach
Model Context Protocol (MCP) servers to the agent pipeline. Everything
behavioural in this document is **recorded**, not guessed: the experiments run
the real `opencode` binary the workflow installs, against a throwaway stdio MCP
server in `/tmp` that is never committed.

## Confidence labels

Every behavioural claim carries one of two labels:

- **verified** — observed in a live run of the pinned binary; the exact command
  and output are quoted beside the claim.
- **by inspection** — read from source (SDK types, generated client, pipeline
  code) or from committed config; not exercised in a run. Quoted type shapes
  are verbatim from the file cited.

## What this research must not lose

Per the maintainer's requested changes, the analysis leads with the pipeline's
isolation gates and only then with ergonomics. Any configuration surface for
MCP servers is judged first on whether it preserves:

1. **Deny-by-default permissions** — `buildOpencodeConfig` grants tools by name
   on top of `"*": "deny"` in `src/openai-config.ts:77-103`; an MCP server's
   tools must not become callable without an explicit grant.
2. **Provider pinning** — one model endpoint, named in one place
   (`src/openai-config.ts`); no second place a model or provider is named.
3. **Credential containment** — OpenCode is never handed the real provider key;
   `src/provider-proxy.ts` holds it and everything downstream is configured
   with the loopback placeholder, because the spawned server's environment is
   model-readable.
4. **Untrusted-input handling** — issue and comment text is attacker-controlled
   and must never become configuration.
5. **Exfiltration channels** — what a configured server adds to what a prompt
   injection can reach.

UX simplicity is assessed second, per surface, in §3.

## 1. The MCP config surface, as the pinned SDK declares it

Pin: `@opencode-ai/sdk@1.18.7` (`opencode-agent/package.json`).

### 1.1 Config-file shapes (**by inspection**)

Quoted verbatim from
`opencode-agent/node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts:1462-1503`:

```ts
export type McpLocalConfig = {
    /**
     * Type of MCP server connection
     */
    type: "local";
    /**
     * Command and arguments to run the MCP server
     */
    command: Array<string>;
    cwd?: string;
    environment?: {
        [key: string]: string;
    };
    enabled?: boolean;
    timeout?: number;
};
export type McpOAuthConfig = {
    clientId?: string;
    clientSecret?: string;
    scope?: string;
    callbackPort?: number;
    redirectUri?: string;
};
export type McpRemoteConfig = {
    /**
     * Type of MCP server connection
     */
    type: "remote";
    /**
     * URL of the remote MCP server
     */
    url: string;
    enabled?: boolean;
    headers?: {
        [key: string]: string;
    };
    /**
     * OAuth authentication configuration for the MCP server. Set to false to disable OAuth auto-detection.
     */
    oauth?: McpOAuthConfig | false;
    timeout?: number;
};
```

The `mcp` key on the top-level `Config` type
(`types.gen.d.ts:1583-1587`, **by inspection**) is a name-keyed map:

```ts
    mcp?: {
        [key: string]: McpLocalConfig | McpRemoteConfig | {
            enabled: boolean;
        };
    };
```

The third member — `{ enabled: boolean }` with no connection fields — is the
shape that toggles a server defined elsewhere (for example by a lower-precedence
config layer) without restating it.

### 1.2 Runtime endpoints (**by inspection**)

From the generated client in
`opencode-agent/node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.js`
(`Mcp` class, and its `auth` accessor on `Auth2`):

| Endpoint                            | Generated method             | Purpose                                                                     | Usable from an unattended pipeline?                                              |
| ----------------------------------- | ---------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET /mcp`                          | `mcp.status()`               | Status of all configured MCP servers                                        | **Usable** — read-only status probe.                                             |
| `POST /mcp`                         | `mcp.add()`                  | Dynamically add a server to a running instance                              | Usable in principle; the pipeline injects config at boot instead, so not needed. |
| `POST /mcp/{name}/connect`          | `mcp.connect()`              | Connect a configured server                                                 | Usable; unnecessary — configured servers connect at boot.                        |
| `POST /mcp/{name}/disconnect`       | `mcp.disconnect()`           | Disconnect a server                                                         | Usable; not needed for one-job-one-session runs.                                 |
| `POST /mcp/{name}/auth`             | `mcp.auth.start()`           | Start the OAuth flow for a server                                           | **Not usable** — begins an interactive flow.                                     |
| `DELETE /mcp/{name}/auth`           | `mcp.auth.remove()`          | Remove stored OAuth credentials                                             | Usable; irrelevant without a completed OAuth flow.                               |
| `POST /mcp/{name}/auth/callback`    | `mcp.auth.callback()`        | Complete OAuth with an authorization code                                   | **Not usable** — presupposes a browser obtained the code.                        |
| `POST /mcp/{name}/auth/authenticate` | `mcp.auth.authenticate()`   | Start OAuth and wait for callback; the client doc comment: _"opens browser"_ | **Not usable** — a CI job has no browser.                                        |

### 1.3 Server status states (**by inspection**)

`GET /mcp` answers one of five states per server
(`types.gen.d.ts:1965-1982`):

```ts
export type McpStatusConnected = {
    status: "connected";
};
export type McpStatusDisabled = {
    status: "disabled";
};
export type McpStatusFailed = {
    status: "failed";
    error: string;
};
export type McpStatusNeedsAuth = {
    status: "needs_auth";
};
export type McpStatusNeedsClientRegistration = {
    status: "needs_client_registration";
    error: string;
};
```

Read for an unattended pipeline:

- `connected` — the only state that makes a server's tools callable.
- `disabled` — the `enabled: false` / `{ enabled: false }` shape; tools absent.
- `failed` — boot or handshake failure, with an `error` string. Whether a
  failed server blocks the phase or merely leaves its tools absent is a
  behavioural question, recorded by experiment in §1.4.
- `needs_auth` — **dead end without a browser.** The only exits are the OAuth
  endpoints above, all interactive. A remote server that demands OAuth is
  therefore not a candidate for this pipeline at all; only static-credential
  (`headers`) remotes and unauthenticated remotes are.
- `needs_client_registration` — the dynamic-client-registration variant of the
  same dead end: the flow still terminates in an interactive authorization.

### 1.4 Behaviour recorded from the live binary

Tool naming (`<server>_<tool>`), boot-failure degradation, and `enabled: false`
semantics are recorded here from live runs of the pinned binary in step 2 of
the implementing plan.
