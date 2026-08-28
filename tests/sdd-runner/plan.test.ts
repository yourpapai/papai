// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  materializeChildFiles,
  planDigest,
  PlanSchema,
  topoSortChildren,
  validatePlan,
} from '../../sdd-runner/src/plan.js'
import type { PlanChild, PlanFsDeps } from '../../sdd-runner/src/plan.js'

interface ChildInput {
  readonly id: string
  readonly instruction: string
  readonly deps: string[]
  readonly capabilities?: string[]
}

function child(id: string, deps: string[] = [], capabilities: string[] = []): ChildInput {
  return capabilities.length === 0
    ? { id, instruction: `do ${id}`, deps }
    : { id, instruction: `do ${id}`, deps, capabilities }
}

function ids(children: readonly PlanChild[]): string[] {
  return children.map((entry) => entry.id)
}

function validationError(input: unknown): string {
  try {
    validatePlan(input)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected validatePlan to reject the plan')
}

const tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-plan-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

interface FakeFs {
  readonly deps: PlanFsDeps
  readonly mkdirs: string[]
  readonly unlinks: string[]
  readonly fileNames: () => string[]
  readonly contentOf: (file: string) => string
  readonly contentAt: (index: number) => string
}

function fakeFs(): FakeFs {
  const mkdirs: string[] = []
  const unlinks: string[] = []
  const files = new Map<string, string>()
  return {
    deps: {
      mkdir: (dir: string): Promise<string | undefined> => {
        mkdirs.push(dir)
        return Promise.resolve(undefined)
      },
      readdir: (dir: string): Promise<string[]> =>
        Promise.resolve(
          [...files.keys()].filter((file) => path.dirname(file) === dir).map((file) => path.basename(file)),
        ),
      unlink: (file: string): Promise<void> => {
        unlinks.push(file)
        files.delete(file)
        return Promise.resolve()
      },
      writeFile: (file: string, data: string): Promise<void> => {
        files.set(file, data)
        return Promise.resolve()
      },
    },
    mkdirs,
    unlinks,
    fileNames: () => [...files.keys()],
    contentOf: (file: string): string => files.get(file) ?? '',
    contentAt: (index: number): string => files.get([...files.keys()][index] ?? '') ?? '',
  }
}

describe('PlanSchema', () => {
  it('defaults an omitted deps array to empty and leaves capabilities optional', () => {
    const plan = PlanSchema.parse({
      children: [{ id: 'alpha', instruction: 'do alpha' }],
    })
    expect(plan).toEqual({
      children: [{ id: 'alpha', instruction: 'do alpha', deps: [] }],
    })
  })

  it('keeps capabilities when present', () => {
    const plan = PlanSchema.parse({
      children: [{ id: 'alpha', instruction: 'do alpha', capabilities: ['codeindex'] }],
    })
    expect(plan.children[0]?.capabilities).toEqual(['codeindex'])
  })

  it('rejects a child with an empty id', () => {
    expect(() => PlanSchema.parse({ children: [{ id: '', instruction: 'do x' }] })).toThrow()
  })

  it('rejects a child with an empty instruction', () => {
    expect(() => PlanSchema.parse({ children: [{ id: 'alpha', instruction: '' }] })).toThrow()
  })

  it('rejects a plan with no children', () => {
    expect(() => PlanSchema.parse({ children: [] })).toThrow()
  })

  it('accepts an eight-child plan — no upper bound', () => {
    const children = Array.from({ length: 8 }, (_, index) => child(`step-${index + 1}`))
    const plan = PlanSchema.parse({ children })
    expect(plan.children).toHaveLength(8)
  })

  it('accepts an optional changeName — old plans parse unchanged (D6)', () => {
    const plan = PlanSchema.parse({
      children: [{ id: 'alpha', instruction: 'do alpha', changeName: 'add-thing' }],
    })
    expect(plan.children[0]?.changeName).toBe('add-thing')
    const legacy = PlanSchema.parse({ children: [{ id: 'alpha', instruction: 'do alpha' }] })
    expect(legacy.children[0]?.changeName).toBeUndefined()
  })

  it('rejects an empty changeName', () => {
    expect(() => PlanSchema.parse({ children: [{ id: 'alpha', instruction: 'do', changeName: '' }] })).toThrow()
  })
})

describe('validatePlan', () => {
  it('returns the normalized plan when the structure is sound', () => {
    const plan = validatePlan({
      children: [child('alpha'), child('beta', ['alpha'])],
    })
    expect(plan).toEqual({
      children: [
        { id: 'alpha', instruction: 'do alpha', deps: [] },
        { id: 'beta', instruction: 'do beta', deps: ['alpha'] },
      ],
    })
  })

  it('rejects duplicate ids in a single error naming every duplicate', () => {
    const message = validationError({
      children: [child('alpha'), child('beta'), child('alpha'), child('beta')],
    })
    expect(message).toMatch(/duplicate/u)
    expect(message).toContain('alpha')
    expect(message).toContain('beta')
  })

  it('rejects unknown deps in a single error naming every unknown dep', () => {
    const message = validationError({
      children: [child('alpha'), child('beta', ['ghost', 'phantom'])],
    })
    expect(message).toMatch(/unknown/u)
    expect(message).toContain('ghost')
    expect(message).toContain('phantom')
  })

  it('rejects self-dependencies in a single error naming every self-dependent id', () => {
    const message = validationError({
      children: [child('alpha', ['alpha']), child('beta', ['beta']), child('gamma')],
    })
    expect(message).toMatch(/self/u)
    expect(message).toContain('alpha')
    expect(message).toContain('beta')
    expect(message).not.toContain('gamma')
  })

  it('accumulates every violation class into one error', () => {
    const message = validationError({
      children: [child('alpha'), child('alpha'), child('beta', ['ghost'])],
    })
    expect(message).toMatch(/duplicate/u)
    expect(message).toMatch(/unknown/u)
    expect(message).toContain('alpha')
    expect(message).toContain('ghost')
  })

  it('adds no structural rule for changeName — a carrying plan validates unchanged (D6)', () => {
    const plan = validatePlan({
      children: [child('alpha'), { ...child('beta', ['alpha']), changeName: 'existing-change' }],
    })
    expect(plan.children[1]?.changeName).toBe('existing-change')
  })
})

describe('topoSortChildren', () => {
  it('orders every dependency before its dependent regardless of declaration order', () => {
    const sorted = topoSortChildren({
      children: [child('beta', ['alpha']), child('alpha')],
    })
    expect(ids(sorted)).toEqual(['alpha', 'beta'])
  })

  it('returns declaration order when children are independent', () => {
    const sorted = topoSortChildren({
      children: [child('n2'), child('n1'), child('n0')],
    })
    expect(ids(sorted)).toEqual(['n2', 'n1', 'n0'])
  })

  it('breaks ready-set ties by declaration index', () => {
    const sorted = topoSortChildren({
      children: [
        child('delta', ['beta', 'gamma']),
        child('beta', ['alpha']),
        child('gamma', ['alpha']),
        child('alpha'),
      ],
    })
    expect(ids(sorted)).toEqual(['alpha', 'beta', 'gamma', 'delta'])
  })

  it('throws naming the leftover set — cycle members and their dependents — on a cycle', () => {
    const cyclic = {
      children: [child('alpha', ['beta']), child('beta', ['alpha']), child('gamma', ['alpha']), child('delta')],
    }
    expect(() => topoSortChildren(cyclic)).toThrow(/^dependency cycle among: alpha, beta, gamma$/u)
  })
})

describe('planDigest', () => {
  it('is the sha-256 of JSON.stringify(topo-ordered [id, instruction] pairs), sliced to 16 hex chars', () => {
    const sorted = topoSortChildren({ children: [child('beta', ['alpha']), child('alpha')] })
    expect(planDigest(sorted)).toBe('a61163921a7cc470')
    expect(planDigest(sorted)).toMatch(/^[0-9a-f]{16}$/u)
  })

  it('is order-sensitive by design: a re-declared order digests differently', () => {
    const declared = topoSortChildren({ children: [child('alpha'), child('beta')] })
    const redeclared = topoSortChildren({ children: [child('beta'), child('alpha')] })
    expect(planDigest(declared)).not.toBe(planDigest(redeclared))
  })

  it('depends on the ordered ids and instructions, not on deps or capabilities', () => {
    const bare = topoSortChildren({ children: [child('alpha'), child('beta')] })
    const rich = topoSortChildren({
      children: [child('alpha', [], ['codeindex']), child('beta', ['alpha'])],
    })
    expect(planDigest(rich)).toBe(planDigest(bare))
  })

  it('diverges on an instruction-only revision — the signal the interrupted-replan recovery compares', () => {
    const before = topoSortChildren({ children: [child('alpha'), child('beta')] })
    const revised = [
      { id: 'alpha', instruction: 'do alpha v2', deps: [] },
      { id: 'beta', instruction: 'do beta', deps: ['alpha'] },
    ]
    expect(planDigest(revised)).not.toBe(planDigest(before))
  })
})

describe('materializeChildFiles', () => {
  it('writes one marker-headed file per child under children/, numbered in topo order', async () => {
    const fake = fakeFs()
    const runDir = path.join('runs', 'parent-42')
    const written = await materializeChildFiles(
      {
        children: [child('Data Layer Setup', ['Foundation']), child('Foundation', [], ['codeindex'])],
      },
      runDir,
      fake.deps,
    )
    expect(fake.mkdirs).toEqual([path.join(runDir, 'children')])
    expect(fake.fileNames()).toEqual([
      path.join(runDir, 'children', '1-foundation.md'),
      path.join(runDir, 'children', '2-data-layer-setup.md'),
    ])
    expect(written).toEqual(['children/1-foundation.md', 'children/2-data-layer-setup.md'])

    const foundation = fake.contentOf(path.join(runDir, 'children', '1-foundation.md'))
    expect(foundation.split('\n')[0]).toContain('GENERATED by sdd-runner')
    expect(foundation).toContain('# Foundation')
    expect(foundation).toContain('do Foundation')
    expect(foundation).toContain('capabilities: codeindex')
    expect(foundation).not.toContain('deps:')

    const dataLayer = fake.contentOf(path.join(runDir, 'children', '2-data-layer-setup.md'))
    expect(dataLayer).toContain('# Data Layer Setup')
    expect(dataLayer).toContain('do Data Layer Setup')
    expect(dataLayer).toContain('deps: Foundation')
    expect(dataLayer).not.toContain('capabilities:')
  })

  it('joins multi-valued deps and capabilities with ", "', async () => {
    const fake = fakeFs()
    await materializeChildFiles(
      {
        children: [child('gamma', ['alpha', 'beta'], ['read', 'write']), child('alpha'), child('beta')],
      },
      'runs/p',
      fake.deps,
    )
    const gamma = fake.contentOf(path.join('runs', 'p', 'children', '3-gamma.md'))
    expect(gamma).toContain('deps: alpha, beta')
    expect(gamma).toContain('capabilities: read, write')
  })

  it('re-materializes wholesale: the same call rewrites the identical file set', async () => {
    const fake = fakeFs()
    const plan = { children: [child('beta', ['alpha']), child('alpha')] }
    await materializeChildFiles(plan, 'runs/p', fake.deps)
    const first = fake.fileNames()
    const firstContent = fake.contentAt(0)
    await materializeChildFiles(plan, 'runs/p', fake.deps)
    expect(fake.fileNames()).toEqual(first)
    expect(fake.contentAt(0)).toBe(firstContent)
    expect(fake.mkdirs).toEqual([path.join('runs', 'p', 'children'), path.join('runs', 'p', 'children')])
  })
  it('deletes files left by a previous plan, so a replan remakes children/ exactly', async () => {
    const fake = fakeFs()
    await materializeChildFiles(
      { children: [child('old-first'), child('old-second', ['old-first'])] },
      'runs/p',
      fake.deps,
    )
    await materializeChildFiles({ children: [child('fresh-only')] }, 'runs/p', fake.deps)
    expect(fake.fileNames()).toEqual([path.join('runs', 'p', 'children', '1-fresh-only.md')])
    expect(fake.unlinks).toEqual([
      path.join('runs', 'p', 'children', '1-old-first.md'),
      path.join('runs', 'p', 'children', '2-old-second.md'),
    ])
  })

  it('keeps non-markdown files in children/ untouched', async () => {
    const fake = fakeFs()
    await fake.deps.writeFile(path.join('runs', 'p', 'children', 'notes.txt'), 'human notes')
    await materializeChildFiles({ children: [child('alpha')] }, 'runs/p', fake.deps)
    expect(fake.unlinks).toEqual([])
    expect(fake.fileNames()).toContain(path.join('runs', 'p', 'children', 'notes.txt'))
    expect(fake.contentOf(path.join('runs', 'p', 'children', 'notes.txt'))).toBe('human notes')
  })
})

describe('materializeChildFiles (default fs seam)', () => {
  it('writes real files to a tmpdir through node:fs/promises', async () => {
    const runDir = path.join(makeTmpDir(), 'runs', 'parent-7')
    const written = await materializeChildFiles({ children: [child('alpha'), child('beta', ['alpha'])] }, runDir)
    expect(fs.readdirSync(path.join(runDir, 'children')).sort()).toEqual(['1-alpha.md', '2-beta.md'])
    expect(written).toEqual(['children/1-alpha.md', 'children/2-beta.md'])
    const beta = fs.readFileSync(path.join(runDir, 'children', '2-beta.md'), 'utf8')
    expect(beta.split('\n')[0]).toContain('GENERATED by sdd-runner')
    expect(beta).toContain('# beta')
    expect(beta).toContain('do beta')
    expect(beta).toContain('deps: alpha')
  })

  it('removes stale files from a previous plan on the real fs seam', async () => {
    const runDir = path.join(makeTmpDir(), 'runs', 'parent-8')
    await materializeChildFiles({ children: [child('old-a'), child('old-b', ['old-a'])] }, runDir)
    await materializeChildFiles({ children: [child('new-a'), child('new-b', ['new-a'])] }, runDir)
    expect(fs.readdirSync(path.join(runDir, 'children')).sort()).toEqual(['1-new-a.md', '2-new-b.md'])
  })
})
