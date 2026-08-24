// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { KILL_GRACE_MS, killGroup, spawnClaude, teardownClaude } from '../../opencode-agent/src/claude-connect.js'
import type {
  ClaudeChild,
  ClaudeChildProcess,
  GroupKillSeams,
  SpawnClaude,
} from '../../opencode-agent/src/claude-connect.js'

/**
 * How the CLI is started and addressed: the spawn contract, the child
 * environment, and the group-kill seam. Everything here runs against an
 * injected spawn — no `claude` binary, no network, per this workspace's rule.
 */

const CREDENTIAL = { name: 'ANTHROPIC_API_KEY' as const, value: 'sk-ant-api03-the-chosen-credential' }

interface RecordedSpawn {
  argv: readonly string[]
  options: {
    detached: boolean
    shell: boolean
    env: Record<string, string>
    cwd: string
    stdio: unknown
  }
}

const blankRecording = (): RecordedSpawn => ({
  argv: [],
  options: { detached: false, shell: false, env: {}, cwd: '', stdio: '' },
})

/** A stdin that records what it was handed. */
interface RecordingStdin {
  written: string
  write(chunk: string): void
  end(): void
}

const recordingStdin = (): RecordingStdin => ({
  written: '',
  write(chunk: string): void {
    this.written += chunk
  },
  end(): void {},
})

/** An async iterable that yields nothing, matching the interface's stream half. */
const emptyChunks = (): AsyncIterable<Uint8Array> => {
  const iterator: AsyncIterator<Uint8Array> = {
    next: (): Promise<IteratorResult<Uint8Array>> => Promise.resolve({ done: true, value: undefined }),
  }
  return { [Symbol.asyncIterator]: (): AsyncIterator<Uint8Array> => iterator }
}

const fakeChild = (pid: number): ClaudeChildProcess & { stdin: RecordingStdin } => {
  const stdin = recordingStdin()
  return { pid, stdin, stdout: emptyChunks(), stderr: emptyChunks(), exited: Promise.resolve(0) }
}

/** A spawn seam that records what it was asked and hands back a placid child. */
const recordingSpawn =
  (recorded: RecordedSpawn, pid: number): SpawnClaude =>
  (binary, argv, options) => {
    recorded.argv = [binary, ...argv]
    recorded.options = {
      detached: options.detached,
      shell: options.shell,
      env: options.env,
      cwd: options.cwd,
      stdio: options.stdio,
    }
    return fakeChild(pid)
  }

/** The child's config dir, read back for assertions. */
const configDirOf = (child: ClaudeChild): string => {
  const dir = child.env['CLAUDE_CONFIG_DIR']
  if (dir === undefined) throw new Error('the child env carries no CLAUDE_CONFIG_DIR')
  return dir
}

const request = (env: Record<string, string | undefined> = {}): Parameters<typeof spawnClaude>[0] => ({
  argv: ['--bare', '-p'],
  stdinPrompt: 'do the work',
  credential: CREDENTIAL,
  workspace: '/runner/workspace',
  env: { PATH: '/usr/bin', ...env },
})

describe('the spawn contract', () => {
  test('spawns the CLI detached, no shell, as an argv vector, in the workspace', () => {
    const recorded = blankRecording()
    spawnClaude(request(), { spawn: recordingSpawn(recorded, 4242), tmpRoot: tmpdir() })

    expect(recorded.argv).toEqual(['claude', '--bare', '-p'])
    expect(recorded.options.detached).toBe(true)
    expect(recorded.options.shell).toBe(false)
    expect(recorded.options.cwd).toBe('/runner/workspace')
    expect(recorded.options.stdio).toBe('pipe')
  })

  test('the prompt is written to stdin', () => {
    const child = fakeChild(1)
    spawnClaude(request(), {
      spawn: (): ClaudeChildProcess => child,
      tmpRoot: tmpdir(),
    })

    expect(child.stdin.written).toBe('do the work')
  })

  test('the child env carries the post-scrub environment plus exactly the chosen credential', () => {
    const recorded = blankRecording()
    const child = spawnClaude(
      request({
        LLM_BASE_URL: 'https://gateway.example/v1',
        AGENT_MCP_SERVERS: '{"index":{"headers":{"authorization":"Bearer mcp"}}}',
        CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token-not-the-chosen-one',
      }),
      { spawn: recordingSpawn(recorded, 4242), tmpRoot: tmpdir() },
    )

    expect(recorded.options.env['PATH']).toBe('/usr/bin')
    expect(recorded.options.env['ANTHROPIC_API_KEY']).toBe(CREDENTIAL.value)
    // The gateway endpoint is stripped by name: the value-based scrub cannot
    // see a non-secret URL, and the endpoint must never ride this route's env.
    expect(recorded.options.env['LLM_BASE_URL']).toBeUndefined()
    // The whole-value scrub removes each embedded MCP credential but can never
    // remove the JSON carrier — and the knob is inert here (--bare runs no MCP).
    expect(recorded.options.env['AGENT_MCP_SERVERS']).toBeUndefined()
    // Only the chosen spelling is present, never the other one.
    expect(recorded.options.env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined()
    expect(child.env).toEqual(recorded.options.env)
  })

  test('CLAUDE_CONFIG_DIR points at a fresh job-scoped dir under the tmp root, outside the workspace', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'claude-connect-test-'))
    try {
      const first = spawnClaude(request(), { spawn: recordingSpawn(blankRecording(), 1), tmpRoot: root })
      const second = spawnClaude(request(), { spawn: recordingSpawn(blankRecording(), 2), tmpRoot: root })

      expect(configDirOf(first)).toStartWith(`${root}${path.sep}`)
      expect(configDirOf(second)).toStartWith(`${root}${path.sep}`)
      expect(configDirOf(first)).not.toBe(configDirOf(second))
      expect(existsSync(configDirOf(first))).toBe(true)
      expect(configDirOf(first)).not.toContain('/runner/workspace')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the determinism knobs are constants, not env-tunable', () => {
    const recorded = blankRecording()
    spawnClaude(request({ DISABLE_AUTOUPDATER: '0' }), { spawn: recordingSpawn(recorded, 4242), tmpRoot: tmpdir() })

    // An operator (or an injected environment) saying 0 does not un-pin the
    // version: two runners must run the same binary the workflow installed.
    expect(recorded.options.env['DISABLE_AUTOUPDATER']).toBe('1')
  })
})

/** Every signal a group kill delivered, as test-readable pairs. */
type SignalLog = Array<[target: number, signal: 'SIGTERM' | 'SIGKILL']>

/** A signal seam that records and always delivers. */
const alwaysDelivers =
  (calls: SignalLog): GroupKillSeams['signal'] =>
  (target, signal) =>
    void calls.push([target, signal])

/** A signal seam that records and finds the group already gone. */
const alwaysGone =
  (calls: SignalLog): GroupKillSeams['signal'] =>
  (target, signal) => {
    calls.push([target, signal])
    throw new Error('ESRCH: no such process')
  }

/** A signal seam that records, lands the SIGTERM, and finds the group dead before the SIGKILL. */
const diesDuringGrace = (calls: SignalLog): GroupKillSeams['signal'] => {
  let terminated = false
  return (target, signal) => {
    calls.push([target, signal])
    if (signal === 'SIGKILL' && terminated) throw new Error('ESRCH: no such process')
    terminated = true
  }
}

const settledSleep =
  (sleeps: number[]): GroupKillSeams['sleep'] =>
  (ms) => {
    sleeps.push(ms)
    return Promise.resolve()
  }

describe('killGroup', () => {
  test('a first signal that finds no live group reports false and escalates nothing', async () => {
    const calls: SignalLog = []

    expect(await killGroup(4242, { signal: alwaysGone(calls) })).toBe(false)
    expect(calls).toEqual([[-4242, 'SIGTERM']])
  })

  test('a delivered SIGTERM waits the named grace, then SIGKILLs the group, and reports true', async () => {
    const calls: SignalLog = []
    const sleeps: number[] = []

    expect(await killGroup(4242, { signal: alwaysDelivers(calls), sleep: settledSleep(sleeps) })).toBe(true)
    expect(calls).toEqual([
      [-4242, 'SIGTERM'],
      [-4242, 'SIGKILL'],
    ])
    expect(sleeps).toEqual([KILL_GRACE_MS])
  })

  test('a group that died from the SIGTERM during the grace still reports true', async () => {
    // First signal lands; by escalation time the group is gone — ESRCH on the
    // SIGKILL is the SIGTERM having worked, not a refusal.
    const calls: SignalLog = []

    expect(await killGroup(4242, { signal: diesDuringGrace(calls), sleep: () => Promise.resolve() })).toBe(true)
    expect(calls).toEqual([
      [-4242, 'SIGTERM'],
      [-4242, 'SIGKILL'],
    ])
  })
})

describe('teardownClaude', () => {
  test('is fire-and-forget: a grace timer that never resolves does not block it', async () => {
    const calls: SignalLog = []
    // A sleep that never settles stands in for the grace timer mid-wait.
    const never = new Promise<void>(() => {})
    const child = fakeChild(4242)
    const spawned = { process: child, configDir: '/tmp/gone-config', env: {} }

    await teardownClaude(spawned, { signal: alwaysDelivers(calls), sleep: () => never })

    expect(calls).toEqual([[-4242, 'SIGTERM']])
  })

  test('after the escalation settles, best-effort removes the config dir', async () => {
    const calls: SignalLog = []
    const removed: string[] = []
    const root = mkdtempSync(path.join(tmpdir(), 'claude-teardown-test-'))
    try {
      const spawned = spawnClaude(request(), { spawn: recordingSpawn(blankRecording(), 4242), tmpRoot: root })
      expect(existsSync(spawned.configDir)).toBe(true)

      await teardownClaude(spawned, {
        signal: alwaysDelivers(calls),
        sleep: () => Promise.resolve(),
        removeDir: (target: string): void => {
          removed.push(target)
        },
      })
      await Bun.sleep(0)

      expect(removed).toEqual([spawned.configDir])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
