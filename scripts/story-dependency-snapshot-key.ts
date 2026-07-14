// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

function frame(bytes: Uint8Array): Uint8Array {
  return Buffer.concat([Buffer.from(String(bytes.byteLength)), Buffer.from('\0'), bytes, Buffer.from('\0')])
}

export function dependencySnapshotKey(
  packageBytes: Uint8Array,
  lockBytes: Uint8Array,
  bunVersion: string,
  workspaceManifests: ReadonlyArray<Readonly<{ path: string; bytes: Uint8Array }>> = [],
): string {
  const hash = createHash('sha256')
  hash.update('papai-story-dependency-key-v2\0')
  for (const value of [packageBytes, lockBytes, Buffer.from(bunVersion)]) hash.update(frame(value))
  for (const workspace of workspaceManifests) {
    hash.update(frame(Buffer.from(workspace.path)))
    hash.update(frame(workspace.bytes))
  }
  return hash.digest('hex')
}
