// tests/operational/run-operational.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Registers every T4 operational lane in boot order. Run explicitly with
// `bun test tests/operational/run-operational.ts`; the `.operational.ts`
// scenario files use a non-discovered suffix so the default `bun test` never
// runs this virtual-clock lane.
import './scenarios/deferred-poller-lifecycle.operational.js'
