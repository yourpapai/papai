// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type ReadChangelogText = (url: URL) => Promise<string>

const defaultReadText: ReadChangelogText = (url) => Bun.file(url).text()

export function readChangelogFile(readText: ReadChangelogText = defaultReadText): Promise<string> {
  return readText(new URL('../CHANGELOG.md', import.meta.url))
}
