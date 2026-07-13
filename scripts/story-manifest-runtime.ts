// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

type RuntimeInput = Readonly<{ kind: 'file' | 'symlink'; path: string; sha256: string; target?: string }>

export function hashRuntimeTree(files: readonly RuntimeInput[], directories: readonly string[]): string {
  const hash = createHash('sha256')
  hash.update('papai-story-runtime-inputs-v2\0')
  for (const directory of directories) {
    hash.update('directory\0')
    hash.update(`${Buffer.byteLength(directory)}:`)
    hash.update(directory)
    hash.update('\0')
  }
  for (const file of files) {
    const pathname = Buffer.from(file.path)
    hash.update(file.kind)
    hash.update('\0')
    hash.update(`${pathname.byteLength}:`)
    hash.update(pathname)
    hash.update('\0')
    hash.update(file.sha256)
    hash.update('\0')
    if (file.kind === 'symlink') {
      hash.update(file.target ?? '')
      hash.update('\0')
    }
  }
  return hash.digest('hex')
}
