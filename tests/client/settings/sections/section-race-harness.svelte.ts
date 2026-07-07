// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// A settable, reactive contextId used by race-test fixtures to simulate the
// top-bar context switcher changing contexts on a live-mounted section.
// Reusable across per-section race fixtures: add one field here per section
// that needs a reactive-contextId race test.
export const raceState = $state<{ contextId: string }>({ contextId: '' })
