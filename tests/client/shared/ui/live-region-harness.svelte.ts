// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// A settable, reactive LiveRegion props object used to prove the element itself survives a
// `tone` change after mount, rather than being torn down and recreated by an `{#if}`/`{:else}`
// branch flip. Mirrors the `field-required-harness.svelte.ts` pattern used for Field prop-race
// fixtures.
export const liveRegionHarnessState = $state<{
  message: string | null
  tone: 'status' | 'alert'
  testid?: string
}>({
  message: 'Preference saved.',
  tone: 'status',
  testid: 'x-live',
})
