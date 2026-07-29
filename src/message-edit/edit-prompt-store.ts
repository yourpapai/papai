// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Pending "ask-first" prompts posted by the W2 side-effects edit branch
 * (`src/message-edit/handle.ts`). Mirrors the register/peek/resolve shape of
 * `src/chat/permission-prompt.ts` so the interaction router can authorize the
 * clicking user against the originating `storageContextId` before invoking the
 * Adjust/Note callback.
 */
export type PendingEditPrompt = {
  contextId: string
  editedText: string
  /**
   * The router awaits these regardless of whether they are sync or async, so
   * `void`-returning handlers are accepted too (this also keeps test stubs
   * free of needless `async` markers).
   */
  onAdjust: () => Promise<void> | void
  onNote: () => Promise<void> | void
}

const pending = new Map<string, PendingEditPrompt>()

export function registerEditPrompt(id: string, prompt: PendingEditPrompt): void {
  pending.set(id, prompt)
}

export function peekEditPrompt(id: string): PendingEditPrompt | undefined {
  return pending.get(id)
}

/**
 * Removes the entry and returns it. The router calls `peekEditPrompt` for the
 * scope check, then `resolveEditPrompt` to claim the callback so a double-click
 * cannot fire the action twice.
 */
export function resolveEditPrompt(id: string): PendingEditPrompt | undefined {
  const prompt = pending.get(id)
  pending.delete(id)
  return prompt
}

/** Test-only: drop all pending edit prompts. */
export function resetEditPromptStoreForTesting(): void {
  pending.clear()
}
