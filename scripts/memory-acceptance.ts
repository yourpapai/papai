#!/usr/bin/env bun
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Operator script: prints the memory Gate 0 production-acceptance contract
 * (see `docs/superpowers/specs/2026-07-29-memory-gate0-acceptance-harness-design.md`).
 *
 * Always exits 0. The report displays status; it never adjudicates production readiness.
 * Enforcement lives in the criterion suites under tests/long-term-memory/acceptance/.
 *
 * Usage:
 *   bun run scripts/memory-acceptance.ts
 */

import { renderAcceptanceReport } from '../tests/long-term-memory/acceptance/report.js'

console.log(renderAcceptanceReport())
