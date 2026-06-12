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

## Sign-in flow

1. Operator DMs `/dashboard` to the bot.
2. Bot replies with a single-use URL valid for 5 minutes.
3. Clicking the link sets a `HttpOnly; Secure; SameSite=Strict` cookie scoped to `/` and redirects to `/admin`.
4. Session lasts 8 hours by default. `POST /auth/logout` revokes immediately.
