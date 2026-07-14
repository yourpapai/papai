// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.

import type { StoryDependencySnapshot } from './story-dependency-snapshot.js'
import type { StorySandboxBackend } from './story-sandbox.js'

type CandidateEvidenceMetadata = Readonly<{
  bunVersion: string
  dependencySnapshot?: StoryDependencySnapshot
  sandboxBackend?: StorySandboxBackend
}>

export function candidateManifestEvidence(metadata: CandidateEvidenceMetadata): Readonly<{
  dependencySnapshot?: Readonly<{ key: string; treeHash: string; bunVersion: string }>
  sandboxBackend?: StorySandboxBackend
}> {
  const dependencySnapshot =
    metadata.dependencySnapshot === undefined
      ? {}
      : {
          dependencySnapshot: {
            key: metadata.dependencySnapshot.key,
            treeHash: metadata.dependencySnapshot.treeHash,
            bunVersion: metadata.bunVersion,
          },
        }
  const sandboxBackend = metadata.sandboxBackend === undefined ? {} : { sandboxBackend: metadata.sandboxBackend }
  return { ...dependencySnapshot, ...sandboxBackend }
}
