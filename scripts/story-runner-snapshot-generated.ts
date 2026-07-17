// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir } from 'node:fs/promises'
import path from 'node:path'

export type GeneratedStorySnapshotEntry = Readonly<{ kind: 'directory'; path: 'node_modules' }>

export async function writeGeneratedStorySnapshotEntry(
  root: string,
  entry: GeneratedStorySnapshotEntry,
): Promise<void> {
  await mkdir(path.join(root, entry.path), { recursive: true })
}
