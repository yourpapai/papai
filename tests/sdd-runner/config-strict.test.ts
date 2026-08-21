// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { loadRunnerConfig } from '../../sdd-runner/src/config.js'

let dir: string
function configPath(name: string): string {
  return path.join(dir, name)
}
function write(name: string, body: unknown): string {
  const p = configPath(name)
  writeFileSync(p, JSON.stringify(body, null, 2))
  return p
}

describe('strict five-key config schema (5.1/5.2)', () => {
  it('accepts exactly the five keys, defaulting budget to 5', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sdd-config-'))
    try {
      const p = write('ok.json', { repoRoot: dir, workDir: '.sdd-runner', model: 'glm/glm-5' })
      const config = await loadRunnerConfig(p)
      expect(config.budget).toBe(5)
      expect(config.model).toBe('glm/glm-5')
      const full = await loadRunnerConfig(
        write('full.json', { repoRoot: dir, workDir: '.sdd-runner', model: 'glm/glm-5', budget: 9, deadline: 30 }),
      )
      expect(full.budget).toBe(9)
      expect(full.deadline).toBe(30)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects each removed key by name with a replacement pointer', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sdd-config-'))
    try {
      const cases: readonly [string, Record<string, unknown>, RegExp][] = [
        ['autonomy.json', { autonomy: { level: 'auto' } }, /autonomy.*budget|budget.*autonomy/su],
        ['models.json', { models: { reviewer: 'glm/glm-5' } }, /models.*model|model.*models/su],
        ['timeouts.json', { timeouts: { wallClockMs: 1 } }, /timeouts/su],
        ['budgetUsd.json', { budgetUsd: 5 }, /budgetUsd.*budget|budget.*budgetUsd/su],
      ]
      for (const [name, extra, pointer] of cases) {
        const p = write(name, {
          repoRoot: dir,
          workDir: '.sdd-runner',
          model: 'glm/glm-5',
          ...extra,
        })
        await expect(loadRunnerConfig(p)).rejects.toThrow(pointer)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
