// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { Glob } from 'bun'

const BANNED = /DEMO_MODE|isDemoUser|demo-auto/u

const findOffenders = async (): Promise<string[]> => {
  const glob = new Glob('src/**/*.ts')
  const offenders: string[] = []
  for await (const file of glob.scan('.')) {
    const text = readFileSync(file, 'utf8')
    if (BANNED.test(text)) offenders.push(file)
  }
  return offenders
}

describe('DEMO_MODE is fully removed from src', () => {
  test('no src file references DEMO_MODE, isDemoUser, or demo-auto', async () => {
    const offenders = await findOffenders()
    expect(offenders).toEqual([])
  })
})
