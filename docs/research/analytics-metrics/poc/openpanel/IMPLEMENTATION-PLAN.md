<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# OpenPanel PoC implementation plan

1. Write failing tests for strict content-free mapping and `profileId`
   eligibility.
2. Write failing tests for independent sink rows, delivered suppression,
   ambiguous terminal state, and bounded pending retries.
3. Write failing transport tests for the localhost boundary, current `/track`
   payload, header-only credentials, and post-ack ambiguity simulation.
4. Implement the pure mapper, read-only canonical source adapter, SQLite
   delivery ledger, bounded `p-limit` dispatcher, and localhost HTTP adapter.
5. Add a CLI and README with secret-safe local commands and explicit
   interpretation limits.
6. Forward the reviewed fixture into the localhost OpenPanel project, capture
   aggregate client and service-native evidence, and verify rerun behavior.
7. If the pinned OpenPanel API exposes a reproducible dashboard contract,
   provision one synthetic-only dashboard with activation, retention,
   top-intent, and error reports. Otherwise record the exact API limitation;
   do not substitute a fabricated screenshot.
8. Run focused tests, typecheck, lint, formatting, a content/secret scan, and
   an independent code review before reporting results.
