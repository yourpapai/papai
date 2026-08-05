// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// A settable, reactive (required, hint) pair used by FieldRequiredRaceFixture to prove
// that the field-error context's `required` and `hasHint` getters track prop changes that
// happen after the Field has already mounted, not just their value at init. Mirrors the
// `section-race-harness.svelte.ts` pattern used for context-id race fixtures.
export const requiredHarnessState = $state<{ required: boolean; hint: string }>({
  required: false,
  hint: '',
})
