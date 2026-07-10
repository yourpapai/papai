// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Outcome of a member-provisioning attempt. */
export type MemberProvisionOutcome = 'created' | 'exists' | 'skipped' | 'failed'

/** Best-effort resolver for a user's human display label in a group context. */
export type UserLabelResolver = (
  userId: string,
  groupContextId: string,
  platformInstanceId: string,
) => Promise<string | null>

/** Aggregate result of a one-shot startup backfill. */
export type MembershipBackfillResult = {
  total: number
  created: number
  exists: number
  skipped: number
  failed: number
}

/**
 * The provisioning behavior a trusted module registers. The port injects the current label
 * resolver into each call so the module needs no late-bound kernel object at load time.
 */
export interface MembershipStore {
  ensureMember(
    groupContextId: string,
    chatUserId: string,
    opts: { username?: string | null },
    resolveUserLabel: UserLabelResolver,
  ): Promise<MemberProvisionOutcome>
  markMemberInactive(groupContextId: string, chatUserId: string): void
  runStartupBackfill(resolveUserLabel: UserLabelResolver): Promise<MembershipBackfillResult>
}

/**
 * Lets the kernel provision task-tracker members without importing the feature that owns the
 * store. A trusted module registers the store at load; the kernel injects a label resolver once
 * its chat provider is composed, and consults ensureMember/markMemberInactive/runStartupBackfill.
 *
 * NOTE: keep this file feature-agnostic — the architecture guard scans src/ports/** for
 * feature/provider names. Do not reference concrete module, provider, or feature names here.
 */
export interface MembershipStorePort {
  register(store: MembershipStore): void
  setUserLabelResolver(resolver: UserLabelResolver): void
  ensureMember(
    groupContextId: string,
    chatUserId: string,
    opts?: { username?: string | null },
  ): Promise<MemberProvisionOutcome>
  markMemberInactive(groupContextId: string, chatUserId: string): void
  runStartupBackfill(): Promise<MembershipBackfillResult>
}

const noopResolver: UserLabelResolver = () => Promise.resolve(null)
const emptyBackfill: MembershipBackfillResult = { total: 0, created: 0, exists: 0, skipped: 0, failed: 0 }

/** Create an isolated port (used by tests and, as a singleton, by the runtime). */
export function createMembershipStorePort(): MembershipStorePort {
  let store: MembershipStore | null = null
  let resolver: UserLabelResolver = noopResolver
  return {
    register: (s) => {
      store = s
    },
    setUserLabelResolver: (r) => {
      resolver = r
    },
    ensureMember: (groupContextId, chatUserId, opts) =>
      store === null
        ? Promise.resolve('skipped')
        : store.ensureMember(groupContextId, chatUserId, opts ?? {}, resolver),
    markMemberInactive: (groupContextId, chatUserId) => {
      if (store !== null) store.markMemberInactive(groupContextId, chatUserId)
    },
    runStartupBackfill: () => (store === null ? Promise.resolve(emptyBackfill) : store.runStartupBackfill(resolver)),
  }
}

/** Process-wide singleton: the task-tracker module registers here; the kernel consults it. */
export const membershipStorePort: MembershipStorePort = createMembershipStorePort()
