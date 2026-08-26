// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { PipelineError } from '../../opencode-agent/src/errors.js'
import type { GitFn } from '../../opencode-agent/src/git-commit.js'
import { assertManifestsInSync } from '../../opencode-agent/src/git-drift.js'
import type { CommandResult } from '../../opencode-agent/src/shell.js'

/**
 * The content-aware drift guard, driven entirely through its `GitFn` seam.
 *
 * The guard reads exactly two things — the changed-path list from
 * `diff --name-only`, and both blob versions of each changed manifest from
 * `git show <ref>:<path>` — so a canned script answers everything it can ask
 * (design D5): no repository fixture can see more of the guard than this does.
 * The scenario list is the spec's: issue #360's scripts-only edit is the false
 * positive that parked a finished branch behind a refusal with no exit, and
 * every fail-closed default (unparseable JSON, one-sided manifests) gets each
 * of its outcomes pinned.
 */

const BRANCH = 'agent/issue-360'
const BASE = 'main'
const BASE_SPEC = 'origin/main:package.json'
const HEAD_SPEC = 'HEAD:package.json'

interface Script {
  /** What `diff --name-only` lists. */
  readonly changed: readonly string[]
  /**
   * Blob payloads by `show` spec (`ref:path`). A spec missing from the map is
   * a side of history that does not carry the file — the added or deleted
   * workspace case.
   */
  readonly blobs?: Readonly<Record<string, string>>
}

const ok = (stdout: string): CommandResult => ({ command: 'git', exitCode: 0, stdout, stderr: '' })

/** Answers the two calls the guard makes; anything else fails the test. */
const scriptedGit = (script: Script): GitFn => {
  const blobs = script.blobs ?? {}
  return (...argv: readonly string[]): Promise<CommandResult> => {
    const [sub, ...rest] = argv
    if (sub === 'diff') return Promise.resolve(ok(script.changed.join('\n')))
    if (sub === 'show') {
      const blob = blobs[rest[0] ?? '']
      // The way git answers a ref that does not carry the path: non-zero
      // exit, nothing on stdout. Whichever GitFn flavour the guard holds —
      // one that reports the exit code, one that throws on it — the side
      // must read as absent, never as an empty manifest that cannot parse.
      return Promise.resolve(
        blob === undefined
          ? { command: 'git', exitCode: 128, stdout: '', stderr: 'fatal: path does not exist' }
          : ok(blob),
      )
    }
    return Promise.reject(new Error(`unexpected git call: ${argv.join(' ')}`))
  }
}

/** A manifest pretty-printed the way a hand edit leaves it. */
const manifest = (fields: Readonly<Record<string, unknown>>): string => `${JSON.stringify(fields, null, 2)}\n`

/** Narrows a caught refusal, failing the test on anything else. */
const asPipelineError = (error: unknown): PipelineError => {
  if (error instanceof PipelineError) return error
  throw new Error(`expected a PipelineError, got: ${String(error)}`)
}

/** Runs the guard on a script that must refuse; fails the test when it passes. */
const refusalFrom = async (script: Script): Promise<PipelineError> => {
  const error: unknown = await assertManifestsInSync(scriptedGit(script), BRANCH, BASE).then(
    () => null,
    (caught: unknown) => caught,
  )
  if (error === null) throw new Error('expected the guard to refuse the branch; it let it through')
  return asPipelineError(error)
}

describe('assertManifestsInSync · edits that cannot move install state pass', () => {
  test('the issue #360 shape: a `scripts` command string moved, nothing else', async () => {
    const base = manifest({ name: 'papai', scripts: { 'check:verbose': 'bun run check' } })
    const head = manifest({ name: 'papai', scripts: { 'check:verbose': 'bun run check --verbose' } })

    await assertManifestsInSync(
      scriptedGit({ changed: ['package.json'], blobs: { [BASE_SPEC]: base, [HEAD_SPEC]: head } }),
      BRANCH,
      BASE,
    )
  })

  test('a semantically identical dependencies map, re-serialized, passes', async () => {
    // Key order and whitespace are the false-positive class this change exists
    // to remove: a re-save of the same map must not read as drift. The `scripts`
    // key moving beside it is the #360 shape riding along.
    const base = '{\n  "dependencies": { "left": "^1.0.0", "right": "^2.0.0" }\n}\n'
    const head = '{"dependencies":{"right":"^2.0.0","left":"^1.0.0"},"scripts":{"build":"bun run build"}}'

    await assertManifestsInSync(
      scriptedGit({ changed: ['package.json'], blobs: { [BASE_SPEC]: base, [HEAD_SPEC]: head } }),
      BRANCH,
      BASE,
    )
  })

  test('an added workspace naming only `name` passes', async () => {
    await assertManifestsInSync(
      scriptedGit({
        changed: ['sdd-runner/package.json'],
        blobs: { 'HEAD:sdd-runner/package.json': manifest({ name: 'sdd-runner' }) },
      }),
      BRANCH,
      BASE,
    )
  })

  test('a deleted manifest that carried no install fields passes', async () => {
    await assertManifestsInSync(
      scriptedGit({
        changed: ['old/package.json'],
        blobs: { 'origin/main:old/package.json': manifest({ name: 'old', version: '1.0.0' }) },
      }),
      BRANCH,
      BASE,
    )
  })
})

describe('assertManifestsInSync · install-relevant fields refuse', () => {
  const sample = (field: string): unknown => (field === 'workspaces' ? ['packages/*'] : { 'left-pad': '^1.0.0' })

  const FIELDS = [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
    'resolutions',
    'overrides',
    'workspaces',
    'trustedDependencies',
    'patchedDependencies',
  ] as const

  for (const field of FIELDS) {
    test(`refuses a changed \`${field}\`, naming the file and the field`, async () => {
      const refusal = await refusalFrom({
        changed: ['package.json'],
        blobs: {
          [BASE_SPEC]: manifest({ name: 'papai' }),
          [HEAD_SPEC]: manifest({ name: 'papai', [field]: sample(field) }),
        },
      })

      expect(refusal.code).toBe('DEPENDENCY_DRIFT')
      expect(refusal.message).toContain('package.json')
      expect(refusal.message).toContain(field)
    })
  }

  test('refuses a removed `devDependencies` just as an added one', async () => {
    const refusal = await refusalFrom({
      changed: ['package.json'],
      blobs: {
        [BASE_SPEC]: manifest({ name: 'papai', devDependencies: { zod: '^4.0.0' } }),
        [HEAD_SPEC]: manifest({ name: 'papai' }),
      },
    })

    expect(refusal.code).toBe('DEPENDENCY_DRIFT')
    expect(refusal.message).toContain('devDependencies')
  })

  test('an added workspace declaring `dependencies` refuses, naming the field', async () => {
    const refusal = await refusalFrom({
      changed: ['sdd-runner/package.json'],
      blobs: {
        'HEAD:sdd-runner/package.json': manifest({ name: 'sdd-runner', dependencies: { zod: '^4.0.0' } }),
      },
    })

    expect(refusal.code).toBe('DEPENDENCY_DRIFT')
    expect(refusal.message).toContain('sdd-runner/package.json')
    expect(refusal.message).toContain('dependencies')
  })

  test('a deleted manifest that carried install fields refuses', async () => {
    const refusal = await refusalFrom({
      changed: ['sdd-runner/package.json'],
      blobs: {
        'origin/main:sdd-runner/package.json': manifest({ name: 'sdd-runner', devDependencies: { zod: '^4.0.0' } }),
      },
    })

    expect(refusal.code).toBe('DEPENDENCY_DRIFT')
    expect(refusal.message).toContain('sdd-runner/package.json')
    expect(refusal.message).toContain('devDependencies')
  })

  test('names every drifted file with its fields in the opening line', async () => {
    const refusal = await refusalFrom({
      changed: ['package.json', 'sdd-runner/package.json'],
      blobs: {
        [BASE_SPEC]: manifest({ name: 'papai' }),
        [HEAD_SPEC]: manifest({ name: 'papai', devDependencies: { zod: '^4.0.0' }, resolutions: { x: 'y' } }),
        'HEAD:sdd-runner/package.json': manifest({ name: 'sdd-runner', dependencies: { zod: '^4.0.0' } }),
      },
    })

    expect(refusal.message).toContain('package.json (devDependencies, resolutions)')
    expect(refusal.message).toContain('sdd-runner/package.json (dependencies)')
  })
})

describe('assertManifestsInSync · the lockfile refuses on any diff', () => {
  test('a lockfile byte change refuses, unconditionally', async () => {
    const refusal = await refusalFrom({ changed: ['bun.lock'] })

    expect(refusal.code).toBe('DEPENDENCY_DRIFT')
    expect(refusal.message).toContain('bun.lock')
  })

  test('a scripts-only manifest edit beside a lockfile diff does not soften the refusal', async () => {
    const base = manifest({ name: 'papai', scripts: { check: 'bun run check' } })
    const head = manifest({ name: 'papai', scripts: { check: 'bun run check --verbose' } })
    const refusal = await refusalFrom({
      changed: ['bun.lock', 'package.json'],
      blobs: { [BASE_SPEC]: base, [HEAD_SPEC]: head },
    })

    expect(refusal.code).toBe('DEPENDENCY_DRIFT')
    expect(refusal.message).toContain('bun.lock')
    // The manifest did not drift, so the refusal must not name it.
    expect(refusal.message).not.toContain('package.json')
  })
})

describe('assertManifestsInSync · unknown shapes fail closed', () => {
  test('malformed JSON on the branch side refuses, naming the file', async () => {
    const refusal = await refusalFrom({
      changed: ['sdd-runner/package.json'],
      blobs: {
        'origin/main:sdd-runner/package.json': manifest({ name: 'sdd-runner' }),
        'HEAD:sdd-runner/package.json': '{ not json',
      },
    })

    expect(refusal.code).toBe('DEPENDENCY_DRIFT')
    expect(refusal.message).toContain('sdd-runner/package.json')
  })

  test('malformed JSON on the base side refuses too', async () => {
    const refusal = await refusalFrom({
      changed: ['package.json'],
      blobs: { [BASE_SPEC]: '{ not json', [HEAD_SPEC]: manifest({ name: 'papai' }) },
    })

    expect(refusal.code).toBe('DEPENDENCY_DRIFT')
    expect(refusal.message).toContain('package.json')
  })
})
