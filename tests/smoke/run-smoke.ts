// tests/smoke/run-smoke.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Registers every T2 container lane in boot order. Run explicitly with
// `bun test tests/smoke/run-smoke.ts`; the `.smoke.ts` scenario files use a
// non-discovered suffix so the default `bun test` never runs this Docker lane.
import './scenarios/container-p.smoke.js'
import './scenarios/container-d.smoke.js'
import './scenarios/container-e.smoke.js'
