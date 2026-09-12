// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Stable curated IDs for the documented behavior inventory. Each ID anchors one
 * independently observable top-level behavior in the behavior document via a
 * `<!-- behavior:<id> -->` marker placed directly above its bullet; the harness
 * contract test asserts every ID here occurs exactly once there. IDs are kebab-case,
 * listed in document order, and never renamed or reused — retire a behavior by
 * removing both the marker and the ID in the same change.
 */
export const BEHAVIOR_DOCUMENT_PATH = 'docs/architecture/behaviors.md' as const

export const DOCUMENTED_BEHAVIOR_IDS = [
  'thread-scoped-contexts',
  'scope-model',
  'settings-only-configuration',
  'reply-to-bot-routing',
  'identity-provisioning',
  'guest-readonly',
  'alert-edge-triggering',
  'repo-catalogue',
  'release-announcements',
  'mid-run-control',
  'live-status',
  'chat-participant-resolution',
  'privacy-gated-analytics',
] as const

export type DocumentedBehaviorId = (typeof DOCUMENTED_BEHAVIOR_IDS)[number]

/**
 * Provenance for one documented behavior: the repository-relative document that
 * declares it plus the exact marker text anchoring it, so the ledger can point at
 * durable source instead of drifting line numbers.
 */
export type BehaviorSource = Readonly<{
  documentPath: typeof BEHAVIOR_DOCUMENT_PATH
  anchor: `<!-- behavior:${DocumentedBehaviorId} -->`
}>

export function behaviorSource(id: DocumentedBehaviorId): BehaviorSource {
  return { documentPath: BEHAVIOR_DOCUMENT_PATH, anchor: `<!-- behavior:${id} -->` }
}
