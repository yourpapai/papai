<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Dashboard access patterns

The debug/admin dashboard binds to `DEBUG_HOSTNAME` (default `127.0.0.1`) on `DEBUG_PORT` (default `9100`). The application's session-cookie auth assumes one of the following deployment patterns; **do not expose the dashboard on a public interface without one**.

## 1. SSH local forward (baseline)

```bash
ssh -L 9100:127.0.0.1:9100 user@host
```

Browse to `http://127.0.0.1:9100/admin`. DM `/dashboard` to the bot, click the link.

## 2. Tailscale Serve / tailnet-only bind

Set `DEBUG_HOSTNAME=100.x.y.z` (your tailnet IP) and visit from another tailnet device. Optionally configure Tailscale Serve to expose `/admin` under a magicdns hostname.

## 3. Reverse proxy with upstream OIDC

Run the bot behind oauth2-proxy / Authelia / authentik / Cloudflare Access. The dashboard's session cookie still applies inside that perimeter — it is a defense in depth, not a replacement for upstream identity.

## Required configuration

- `ADMIN_USER_ID` must match the chat platform user ID of the admin who will run `/dashboard`.
- `DASHBOARD_BASE_URL` should be the externally-reachable origin of the dashboard if it differs from `http://{DEBUG_HOSTNAME}:{DEBUG_PORT}`.
- For HTTPS deployments, the reverse proxy must forward `X-Forwarded-Proto: https` so the bot emits the `Secure` cookie attribute.

## What `DEBUG_SERVER` does and does not gate

`DEBUG_SERVER=true` enables the engineer live-observability surface. When `DEBUG_SERVER=false` (the default for production deployments), the server 404s the following paths — collectively defined as `DEBUG_ONLY_PATHS` in `src/debug/server.ts`:

- `/debug`, `/debug.js`, `/debug.css`
- `/events` (SSE stream)
- `/logs`, `/logs/stats`
- `/dashboard` (redirect alias to `/debug`)
- `/turns/*` (turn lookup — additionally **scope-filtered**: only turns in the operator's own contexts are returned; a turn in any other user/group context returns `404`, matching the SSE event filter)

**The operator surfaces are not gated by `DEBUG_SERVER`.** The following paths remain reachable whenever the debug server process is running, regardless of the `DEBUG_SERVER` flag:

- `/admin` (read-only dashboard: Overview, Billing, Stats, Memos, Reminders, Identities)
- `/billing/*`
- `/stats/*`

Admin controls (LLM credentials, platform/task instances, plugin config, groups) are managed exclusively through the settings admin section (`/settings/api/admin/*`, super-admin gated via the settings session cookie).

Authorization for the `/admin` dashboard and billing/stats routes is the **dashboard session cookie** (obtained via the `/dashboard` sign-in flow), not `DEBUG_SERVER`. This is intentional: operators need production observability without exposing the raw SSE/log streams.

> **Tip:** If you want to run only the operator surfaces without the live-observability streams, start the process with `DEBUG_SERVER=false` (or omit the variable). The sign-in flow, `/admin`, `/billing`, and `/stats` routes will all work normally.

## Sign-in flow

1. Operator DMs `/dashboard` to the bot.
2. Bot replies with a single-use URL valid for 5 minutes.
3. Opening the link (`GET /auth/claim`) renders a confirmation page only — it does **not** consume the nonce. This is deliberate: messaging-platform link-preview crawlers (Telegram, Slack, etc.) issue a `GET` when the link is sent, and consuming on `GET` would burn the single-use claim before the operator opens it. The bot also sends the link with link previews disabled as defense in depth.
4. Pressing **Sign in** on that page submits `POST /auth/claim`, which consumes the nonce, sets a `HttpOnly; Secure; SameSite=Strict` cookie scoped to `/`, and redirects to `/admin`.
5. Session lasts 8 hours by default. `POST /auth/logout` revokes immediately.
