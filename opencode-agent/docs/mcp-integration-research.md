<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# MCP integration research

How the opencode-agent pipeline could attach external MCP servers to the
OpenCode sessions it spawns: what the SDK's config surface allows, what the
`opencode` binary actually does with it, which configuration surface would
carry that for a maintainer, and what the CI environment's constraints do to
each candidate.

## Scope

This is a **research document only**. It changes no production code, no
workflow, no configuration. Its one job is to record what was found — from the
pinned SDK types, from live runs of the `opencode` binary, and from the CI
constraints already recorded in `ROADMAP.md` — so a later implementation step
can be planned against evidence rather than guessed at.

## Maintainer decisions in force

Recorded here so every section below evaluates against the same brief:

- **MCP tools are granted to all profiles.** If an MCP server is configured,
  its tools are allowed in every agent profile (`plan` and `build` alike); the
  deny-by-default capability model in `openai-config.ts` gains a grant shape
  that covers them, not a per-profile pick-and-choose.
- **Per-server opt-out is deferred and out of scope for this document's
  recommendation.** It is listed as a follow-up, not designed here.

## Confidence labelling

Every behavioural claim in this document carries one of two labels, the same
convention the sibling documents use:

- **verified** — observed against the real `opencode` binary (or read from a
  pinned file whose exact lines are cited), with the command or method stated.
- **by inspection** — derived from reading source, types or docs without a
  live run; the claim is as strong as the file it cites and no stronger.

Any claim not derivable from the cited material is labelled **by inspection**
explicitly, so a reader can weigh it accordingly.

## OpenCode MCP config surface

Everything below is quoted **verbatim** from the pinned SDK —
`node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts` — with the line
range of each quote cited, so a pin bump can be checked by re-reading the same
range rather than trusting this document.

### Static configuration types (`types.gen.d.ts:1462-1503`)

```typescript
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

Two shapes, discriminated on `type`: a **local** server is a spawned command
(`command`, plus optional `cwd`, `environment`, `enabled`, `timeout`), and a
**remote** server is a URL with optional `headers` and an `oauth` field that
takes either an `McpOAuthConfig` or the literal `false`. The doc comment on
`oauth` is the load-bearing line for unattended use: _"Set to false to disable
OAuth auto-detection."_

### Runtime status union (`types.gen.d.ts:1965-1982`)

```typescript
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
export type McpStatus = McpStatusConnected | McpStatusDisabled | McpStatusFailed | McpStatusNeedsAuth | McpStatusNeedsClientRegistration;
```

Five states. `connected` and `disabled` are the healthy ones; `failed` carries
an error string; `needs_auth` and `needs_client_registration` are the two
OAuth-driven states — a server in either of them is waiting on an interactive
flow that nobody in a CI job can perform.

### Runtime endpoints (`types.gen.d.ts:7197-7411`)

The range is quoted verbatim; it ends mid-declaration at the pinned line
(inside `McpDisconnectData`), which is noted rather than "fixed" so the quote
stays diffable against the file.

```typescript
export type McpStatusData = {
    body?: never;
    path?: never;
    query?: {
        directory?: string;
        workspace?: string;
    };
    url: "/mcp";
};
export type McpStatusErrors = {
    /**
     * Bad request
     */
    400: BadRequestError;
};
export type McpStatusError = McpStatusErrors[keyof McpStatusErrors];
export type McpStatusResponses = {
    /**
     * MCP server status
     */
    200: {
        [key: string]: McpStatus;
    };
};
export type McpStatusResponse = McpStatusResponses[keyof McpStatusResponses];
export type McpAddData = {
    body?: {
        name: string;
        config: McpLocalConfig | McpRemoteConfig;
    };
    path?: never;
    query?: {
        directory?: string;
        workspace?: string;
    };
    url: "/mcp";
};
export type McpAddErrors = {
    /**
     * BadRequest | InvalidRequestError
     */
    400: EffectHttpApiErrorBadRequest | InvalidRequestError;
};
export type McpAddError = McpAddErrors[keyof McpAddErrors];
export type McpAddResponses = {
    /**
     * MCP server added successfully
     */
    200: {
        [key: string]: McpStatus;
    };
};
export type McpAddResponse = McpAddResponses[keyof McpAddResponses];
export type McpAuthRemoveData = {
    body?: never;
    path: {
        name: string;
    };
    query?: {
        directory?: string;
        workspace?: string;
    };
    url: "/mcp/{name}/auth";
};
export type McpAuthRemoveErrors = {
    /**
     * Bad request
     */
    400: BadRequestError;
    /**
     * McpServerNotFoundError
     */
    404: McpServerNotFoundError;
};
export type McpAuthRemoveError = McpAuthRemoveErrors[keyof McpAuthRemoveErrors];
export type McpAuthRemoveResponses = {
    /**
     * OAuth credentials removed
     */
    200: {
        success: true;
    };
};
export type McpAuthRemoveResponse = McpAuthRemoveResponses[keyof McpAuthRemoveResponses];
export type McpAuthStartData = {
    body?: never;
    path: {
        name: string;
    };
    query?: {
        directory?: string;
        workspace?: string;
    };
    url: "/mcp/{name}/auth";
};
export type McpAuthStartErrors = {
    /**
     * McpUnsupportedOAuthError | InvalidRequestError
     */
    400: McpUnsupportedOAuthError | InvalidRequestError;
    /**
     * McpServerNotFoundError
     */
    404: McpServerNotFoundError;
};
export type McpAuthStartError = McpAuthStartErrors[keyof McpAuthStartErrors];
export type McpAuthStartResponses = {
    /**
     * OAuth flow started
     */
    200: {
        authorizationUrl: string;
        oauthState: string;
    };
};
export type McpAuthStartResponse = McpAuthStartResponses[keyof McpAuthStartResponses];
export type McpAuthCallbackData = {
    body?: {
        code: string;
    };
    path: {
        name: string;
    };
    query?: {
        directory?: string;
        workspace?: string;
    };
    url: "/mcp/{name}/auth/callback";
};
export type McpAuthCallbackErrors = {
    /**
     * BadRequest | InvalidRequestError
     */
    400: EffectHttpApiErrorBadRequest | InvalidRequestError;
    /**
     * McpServerNotFoundError
     */
    404: McpServerNotFoundError;
};
export type McpAuthCallbackError = McpAuthCallbackErrors[keyof McpAuthCallbackErrors];
export type McpAuthCallbackResponses = {
    /**
     * OAuth authentication completed
     */
    200: McpStatus;
};
export type McpAuthCallbackResponse = McpAuthCallbackResponses[keyof McpAuthCallbackResponses];
export type McpAuthAuthenticateData = {
    body?: never;
    path: {
        name: string;
    };
    query?: {
        directory?: string;
        workspace?: string;
    };
    url: "/mcp/{name}/auth/authenticate";
};
export type McpAuthAuthenticateErrors = {
    /**
     * McpUnsupportedOAuthError | InvalidRequestError
     */
    400: McpUnsupportedOAuthError | InvalidRequestError;
    /**
     * McpServerNotFoundError
     */
    404: McpServerNotFoundError;
};
export type McpAuthAuthenticateError = McpAuthAuthenticateErrors[keyof McpAuthAuthenticateErrors];
export type McpAuthAuthenticateResponses = {
    /**
     * OAuth authentication completed
     */
    200: McpStatus;
};
export type McpAuthAuthenticateResponse = McpAuthAuthenticateResponses[keyof McpAuthAuthenticateResponses];
export type McpConnectData = {
    body?: never;
    path: {
        name: string;
    };
    query?: {
        directory?: string;
        workspace?: string;
    };
    url: "/mcp/{name}/connect";
};
export type McpConnectErrors = {
    /**
     * Bad request
     */
    400: BadRequestError;
    /**
     * McpServerNotFoundError
     */
    404: McpServerNotFoundError;
};
export type McpConnectError = McpConnectErrors[keyof McpConnectErrors];
export type McpConnectResponses = {
    /**
     * MCP server connected successfully
     */
    200: boolean;
};
export type McpConnectResponse = McpConnectResponses[keyof McpConnectResponses];
export type McpDisconnectData = {
    body?: never;
    path: {
        name: string;
    };
    query?: {
        directory?: string;
        workspace?: string;
    };
    url: "/mcp/{name}/disconnect";
```

Seven routes, from the `url` fields:

| Method + path                       | Type prefix             | Purpose                      |
| ----------------------------------- | ----------------------- | ---------------------------- |
| `GET /mcp`                          | `McpStatusData`         | status of all servers        |
| `POST /mcp`                         | `McpAddData`            | add a server at runtime      |
| `DELETE /mcp/{name}/auth`           | `McpAuthRemoveData`     | remove OAuth credentials     |
| `POST /mcp/{name}/auth`             | `McpAuthStartData`      | start an OAuth flow          |
| `POST /mcp/{name}/auth/callback`    | `McpAuthCallbackData`   | complete OAuth with a `code` |
| `POST /mcp/{name}/auth/authenticate` | `McpAuthAuthenticateData` | OAuth completion (no body; see below) |
| `POST /mcp/{name}/connect`          | `McpConnectData`        | (re)connect one server       |
| `POST /mcp/{name}/disconnect`       | `McpDisconnectData`     | disconnect one server        |

### Usable unattended vs not

From the shapes alone (**verified** against the pinned types quoted above):

- **Usable unattended:** `GET /mcp`, `POST /mcp`, `POST /mcp/{name}/connect`,
  `POST /mcp/{name}/disconnect`, and `DELETE /mcp/{name}/auth`. Each takes a
  plain JSON body (or none) and returns status — no human step is encoded in
  the request or response shapes.
- **Not usable unattended:** the OAuth trio. `POST /mcp/{name}/auth` returns
  `{ authorizationUrl, oauthState }` — a URL a human must open in a browser —
  and `POST /mcp/{name}/auth/callback` expects the `{ code }` that only that
  browser redirect produces. `McpStatusNeedsAuth` in the status union is the
  state a server sits in while that flow is outstanding, so a remote server
  whose auth depends on it never becomes `connected` inside a CI job.
  `POST /mcp/{name}/auth/authenticate` returns an `McpStatus` and carries no
  body fields, so its request shape alone does not show what credential it
  consumes; whether it can complete a flow without a prior interactive
  `auth`/`callback` round is **by inspection** not determinable from these
  types and is flagged for the live-run section.
- **`oauth: false` is mandatory for remote servers used unattended** — **by
  inspection**: the type comment says only that `false` disables OAuth
  auto-detection; that auto-detection is what would otherwise steer a
  credential-bearing remote server into the `needs_auth` dead end is an
  inference from `McpStatusNeedsAuth` existing, not a statement in the types.
  Header-based credentials (`headers?: { [key: string]: string }`) are the
  only remote-server auth the config types express that requires no flow.

