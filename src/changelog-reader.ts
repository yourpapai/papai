// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export function readChangelogFile(): Promise<string> {
  return Bun.file(new URL('../CHANGELOG.md', import.meta.url)).text()
}
