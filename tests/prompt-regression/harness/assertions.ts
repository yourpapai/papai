// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export function normalizePromptText(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

export function assertContainsAll(text: string, expected: readonly string[] = []): void {
  for (const needle of expected) {
    if (!text.includes(needle)) throw new Error(`Expected text to contain "${needle}"`)
  }
}

export function assertContainsNone(text: string, forbidden: readonly string[] = []): void {
  for (const needle of forbidden) {
    if (text.includes(needle)) throw new Error(`Expected text not to contain "${needle}"`)
  }
}

export function assertInOrder(text: string, expected: readonly string[] = []): void {
  let searchFrom = 0
  let previous = ''
  for (const marker of expected) {
    const index = text.indexOf(marker, searchFrom)
    if (index === -1) {
      if (previous === '') throw new Error(`Expected text marker "${marker}" to appear`)
      throw new Error(`Expected text marker "${marker}" to appear after "${previous}"`)
    }
    searchFrom = index + marker.length
    previous = marker
  }
}

export function assertExactArray(label: string, actual: readonly string[], expected: readonly string[]): void {
  const actualJson = JSON.stringify([...actual])
  const expectedJson = JSON.stringify([...expected])
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${label} ${expectedJson}, received ${actualJson}`)
  }
}
