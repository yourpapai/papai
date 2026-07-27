// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const SESSION_APP_PREFIX = /^\/session\/app\//u
const RELATIVE_PREFIX = /^\.\//u

function normalizeSourceFile(line: string): string {
  const file = line.slice('SF:'.length).replace(SESSION_APP_PREFIX, '').replace(RELATIVE_PREFIX, '')
  return `SF:${file}`
}

export function normalizeLcov(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.startsWith('SF:') ? normalizeSourceFile(line) : line))
    .join('\n')
}
