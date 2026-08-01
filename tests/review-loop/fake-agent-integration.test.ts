// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { z } from 'zod'

import { runCli } from '../../review-loop/src/cli.js'

const TraceEventSchema = z.object({
  event: z.string(),
  addresses: z.boolean().optional(),
  fixed: z.boolean().optional(),
  attempt: z.number().optional(),
})

type TraceEvent = z.infer<typeof TraceEventSchema>

const LedgerIssueSchema = z.object({ status: z.string() })
const LedgerSnapshotSchema = z.object({ issues: z.record(z.string(), LedgerIssueSchema) })

type LedgerSnapshot = z.infer<typeof LedgerSnapshotSchema>

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createFakeOpencode(binDir: string): void {
  const scriptPath = path.join(binDir, 'opencode')
  const script = `#!/usr/bin/env bun
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const prompt = args[args.length - 1] ?? ''

function extractOutputPath(text) {
  const match = text.match(/(?:to|JSON to):\\s*(\\S+)/)
  return match?.[1] ?? null
}

function extractIssueFile(text) {
  const match = text.match(/"file":\\s*"([^"]+)"/)
  return match?.[1] ?? null
}

function extractIssueTitle(text) {
  const match = text.match(/"title":\\s*"([^"]+)"/)
  return match?.[1] ?? null
}

const scenarioPath = process.env.FAKE_OPENCODE_SCENARIO
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'))
const outputPath = extractOutputPath(prompt)

if (prompt.includes('Review the current implementation')) {
  const issues = scenario.reviewerIssues[scenario._reviewerCall ?? 0] ?? '{"issues":[]}'
  scenario._reviewerCall = (scenario._reviewerCall ?? 0) + 1
  writeFileSync(scenarioPath, JSON.stringify(scenario))
  if (outputPath) writeFileSync(outputPath, issues)
} else if (prompt.includes('You are an inspector')) {
  const results = scenario.inspectorResults ?? []
  const result = results[scenario._inspectorCall ?? 0] ?? { addresses: true, reasoning: 'mock', confidence: 0.9 }
  scenario._inspectorCall = (scenario._inspectorCall ?? 0) + 1
  writeFileSync(scenarioPath, JSON.stringify(scenario))
  if (outputPath) writeFileSync(outputPath, JSON.stringify(result))
} else if (prompt.includes('Verify and fix') || prompt.includes('build error') || prompt.includes('inspector said')) {
  if (scenario.makeFixerChanges === true) {
    const issueFile = extractIssueFile(prompt)
    const issueTitle = extractIssueTitle(prompt)
    if (issueFile !== null && issueTitle !== null) {
      const marker = scenario.fixerMarker ?? \`// fixed: \${issueTitle}\`
      writeFileSync(issueFile, \`\${marker}\\n\`, { flag: 'a' })
    }
  }
  const result = scenario.fixerResults[scenario._fixerCall ?? 0] ?? '{}'
  scenario._fixerCall = (scenario._fixerCall ?? 0) + 1
  writeFileSync(scenarioPath, JSON.stringify(scenario))
  if (outputPath) writeFileSync(outputPath, result)
} else if (prompt.includes('Match newly found')) {
  if (outputPath) writeFileSync(outputPath, JSON.stringify({ matches: [] }))
}
process.exit(0)
`
  writeFileSync(scriptPath, script)
  chmodSync(scriptPath, 0o755)
}

function buildIssue(opts: {
  title: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  file: string
  lineStart?: number
  lineEnd?: number
}): object {
  return {
    title: opts.title,
    severity: opts.severity,
    summary: 'Mock summary for testing.',
    whyItMatters: 'Mock reason for testing.',
    evidence: `${opts.file}:1`,
    file: opts.file,
    lineStart: opts.lineStart ?? 1,
    lineEnd: opts.lineEnd ?? 10,
    suggestedFix: 'Mock fix for testing.',
    confidence: 0.9,
  }
}

function buildFixerResult(overrides?: { verdict?: string; fixed?: boolean }): string {
  return JSON.stringify({
    verdict: overrides?.verdict ?? 'valid',
    fixability: 'auto',
    reasoning: 'Mock fixer reasoning.',
    targetFiles: ['src/mock.ts'],
    fixed: overrides?.fixed ?? true,
    commitSha: 'abc123',
    commitMessage: 'fix: mock',
    severity: 'low',
  })
}

async function initRepo(repoPath: string, files: Record<string, string>): Promise<void> {
  const { execFileSync } = await import('node:child_process')
  execFileSync('git', ['init', repoPath])
  execFileSync('git', ['-C', repoPath, 'config', 'user.email', 'test@test.com'])
  execFileSync('git', ['-C', repoPath, 'config', 'user.name', 'Test'])
  execFileSync('git', ['-C', repoPath, 'checkout', '-b', 'main'])
  writeFileSync(path.join(repoPath, '.gitignore'), '.review-loop/\n')
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(repoPath, relativePath)
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, content)
  }
  execFileSync('git', ['-C', repoPath, 'add', '.'])
  execFileSync('git', ['-C', repoPath, 'commit', '-m', 'init'])
}

async function runFakeScenario(opts: {
  dir: string
  reviewerIssues: string[]
  fixerResults: string[]
  inspectorResults?: Array<{ addresses: boolean; reasoning: string; confidence: number }>
  makeFixerChanges?: boolean
  poolSize?: number
  noInspect?: boolean
}): Promise<{ runRoot: string; runId: string; summary: string; ledger: LedgerSnapshot; trace: TraceEvent[] }> {
  const dir = opts.dir
  const binDir = path.join(dir, 'bin')
  const scenarioPath = path.join(dir, 'scenario.json')
  const configPath = path.join(dir, 'config.json')
  const planPath = path.join(dir, 'plan.md')
  const repoPath = path.join(dir, 'repo')

  writeFileSync(planPath, '# Implementation plan\n')

  const scenario: {
    reviewerIssues: string[]
    fixerResults: string[]
    inspectorResults?: Array<{ addresses: boolean; reasoning: string; confidence: number }>
    makeFixerChanges?: boolean
  } = {
    reviewerIssues: opts.reviewerIssues,
    fixerResults: opts.fixerResults,
    makeFixerChanges: opts.makeFixerChanges,
  }
  if (opts.inspectorResults !== undefined) {
    scenario.inspectorResults = opts.inspectorResults
  }
  writeFileSync(scenarioPath, JSON.stringify(scenario))

  const config: {
    repoRoot: string
    workDir: string
    maxRounds: number
    maxNoProgressRounds: number
    checkCommand: string
    poolSize: number
    reviewer: object
    fixer: object
    matcher: object
    inspector?: object
  } = {
    repoRoot: repoPath,
    workDir: path.join(dir, '.review-loop'),
    maxRounds: 5,
    maxNoProgressRounds: 2,
    checkCommand: 'true',
    poolSize: opts.poolSize ?? 1,
    reviewer: { model: 'test-reviewer', extraArgs: [] },
    fixer: { model: 'test-fixer', extraArgs: [] },
    matcher: { model: 'test-matcher', extraArgs: [] },
    inspector: { model: 'test-inspector', extraArgs: [] },
  }
  writeFileSync(configPath, JSON.stringify(config))

  mkdirSync(binDir, { recursive: true })
  createFakeOpencode(binDir)

  const oldPath = process.env['PATH']
  process.env['PATH'] = `${binDir}:${oldPath}`
  process.env['FAKE_OPENCODE_SCENARIO'] = scenarioPath

  const cliArgs = ['--config', configPath, '--plan', planPath]
  if (opts.poolSize !== undefined) {
    cliArgs.push('--pool-size', String(opts.poolSize))
  }
  if (opts.noInspect === true) {
    cliArgs.push('--no-inspect')
  }

  try {
    await runCli(cliArgs)
  } finally {
    process.env['PATH'] = oldPath
    delete process.env['FAKE_OPENCODE_SCENARIO']
  }

  const runRoot = path.join(dir, '.review-loop', 'runs')
  const runId = readdirSync(runRoot)[0]
  if (runId === undefined) {
    throw new Error('No run directory created')
  }
  const summary = readFileSync(path.join(runRoot, runId, 'summary.txt'), 'utf8')
  const ledger = LedgerSnapshotSchema.parse(JSON.parse(readFileSync(path.join(runRoot, runId, 'ledger.json'), 'utf8')))
  const trace = readFileSync(path.join(runRoot, runId, 'trace.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => TraceEventSchema.parse(JSON.parse(line)))
  return { runRoot, runId, summary, ledger, trace }
}

describe('review-loop fake integration', () => {
  test('writes summary after a clean fake-agent run', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'review-loop-integration-'))
    tempDirs.push(dir)

    const binDir = path.join(dir, 'bin')
    const scenarioPath = path.join(dir, 'scenario.json')
    const configPath = path.join(dir, 'config.json')
    const planPath = path.join(dir, 'plan.md')
    const repoPath = path.join(dir, 'repo')

    writeFileSync(planPath, '# Implementation plan\n')

    const scenario = {
      reviewerIssues: [
        JSON.stringify({
          issues: [
            {
              title: 'Race condition',
              severity: 'high',
              summary: 'Concurrent messages bypass lock.',
              whyItMatters: 'Stale replies.',
              evidence: 'queue.ts:84',
              file: 'src/queue.ts',
              lineStart: 84,
              lineEnd: 107,
              suggestedFix: 'Lock earlier.',
              confidence: 0.9,
            },
          ],
        }),
        JSON.stringify({ issues: [] }),
      ],
      fixerResults: [
        JSON.stringify({
          verdict: 'valid',
          fixability: 'auto',
          reasoning: 'Unsafe.',
          targetFiles: ['src/queue.ts'],
          fixed: true,
          commitSha: 'abc123',
        }),
      ],
    }
    writeFileSync(scenarioPath, JSON.stringify(scenario))

    writeFileSync(
      configPath,
      JSON.stringify({
        repoRoot: repoPath,
        workDir: path.join(dir, '.review-loop'),
        maxRounds: 5,
        maxNoProgressRounds: 2,
        checkCommand: 'true',
        reviewer: { model: 'test-reviewer', extraArgs: [] },
        fixer: { model: 'test-fixer', extraArgs: [] },
        matcher: { model: 'test-matcher', extraArgs: [] },
      }),
    )

    const { execFileSync } = await import('node:child_process')
    execFileSync('git', ['init', repoPath])
    execFileSync('git', ['-C', repoPath, 'config', 'user.email', 'test@test.com'])
    execFileSync('git', ['-C', repoPath, 'config', 'user.name', 'Test'])
    execFileSync('git', ['-C', repoPath, 'checkout', '-b', 'main'])
    writeFileSync(path.join(repoPath, '.gitignore'), '.review-loop/\n')
    writeFileSync(path.join(repoPath, 'README.md'), 'hello')
    execFileSync('git', ['-C', repoPath, 'add', '.'])
    execFileSync('git', ['-C', repoPath, 'commit', '-m', 'init'])

    mkdirSync(binDir, { recursive: true })
    createFakeOpencode(binDir)

    const oldPath = process.env['PATH']
    process.env['PATH'] = `${binDir}:${oldPath}`
    process.env['FAKE_OPENCODE_SCENARIO'] = scenarioPath

    try {
      await runCli(['--config', configPath, '--plan', planPath])
    } finally {
      process.env['PATH'] = oldPath
      delete process.env['FAKE_OPENCODE_SCENARIO']
    }

    const runRoot = path.join(dir, '.review-loop', 'runs')
    const runId = readdirSync(runRoot)[0]
    expect(runId).toBeDefined()
    const summary = readFileSync(path.join(runRoot, runId!, 'summary.txt'), 'utf8')
    expect(summary).toContain('Review loop finished: issues remaining')
  })
})

describe('fake agent with pool + inspector', () => {
  test('3 issues, 3 workers, all inspectors accept, run completes clean', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'review-loop-pool-'))
    tempDirs.push(dir)

    const repoPath = path.join(dir, 'repo')
    await initRepo(repoPath, {
      'src/a.ts': 'export const a = 1\n',
      'src/b.ts': 'export const b = 2\n',
      'src/c.ts': 'export const c = 3\n',
    })

    const { summary, trace } = await runFakeScenario({
      dir,
      poolSize: 3,
      makeFixerChanges: true,
      reviewerIssues: [
        JSON.stringify({
          issues: [
            buildIssue({ title: 'Issue A', severity: 'high', file: 'src/a.ts' }),
            buildIssue({ title: 'Issue B', severity: 'medium', file: 'src/b.ts' }),
            buildIssue({ title: 'Issue C', severity: 'low', file: 'src/c.ts' }),
          ],
        }),
        JSON.stringify({ issues: [] }),
      ],
      fixerResults: [buildFixerResult(), buildFixerResult(), buildFixerResult()],
      inspectorResults: [
        { addresses: true, reasoning: 'addresses A', confidence: 0.9 },
        { addresses: true, reasoning: 'addresses B', confidence: 0.9 },
        { addresses: true, reasoning: 'addresses C', confidence: 0.9 },
      ],
    })

    expect(summary).toContain('Review loop finished: done')

    const inspectEvents = trace.filter((e) => e.event === 'inspect_complete')
    expect(inspectEvents.length).toBe(3)
    expect(inspectEvents.every((e) => e.addresses === true)).toBe(true)

    const { execFileSync } = await import('node:child_process')
    const commitCount = Number(
      execFileSync('git', ['-C', repoPath, 'rev-list', '--count', 'main'], { encoding: 'utf8' }).trim(),
    )
    // init commit + 3 fix commits
    expect(commitCount).toBeGreaterThanOrEqual(4)
  })

  test('1 issue, inspector rejects, fixer retries successfully, fixed (after retry)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'review-loop-retry-'))
    tempDirs.push(dir)

    const repoPath = path.join(dir, 'repo')
    await initRepo(repoPath, { 'src/queue.ts': 'export const queue = []\n' })

    const { summary, trace, ledger } = await runFakeScenario({
      dir,
      poolSize: 1,
      makeFixerChanges: true,
      reviewerIssues: [
        JSON.stringify({ issues: [buildIssue({ title: 'Race condition', severity: 'high', file: 'src/queue.ts' })] }),
        JSON.stringify({ issues: [] }),
      ],
      fixerResults: [buildFixerResult(), buildFixerResult()],
      inspectorResults: [
        { addresses: false, reasoning: 'does not lock early enough', confidence: 0.8 },
        { addresses: true, reasoning: 'now locks early', confidence: 0.9 },
      ],
    })

    expect(summary).toContain('Review loop finished: done')

    const inspectEvents = trace.filter((e) => e.event === 'inspect_complete')
    expect(inspectEvents.length).toBe(2)
    expect(inspectEvents[0]?.addresses).toBe(false)
    expect(inspectEvents[1]?.addresses).toBe(true)

    const fixEvents = trace.filter((e) => e.event === 'fix_complete')
    const successfulFix = fixEvents.find((e) => e.fixed === true)
    expect(successfulFix).toBeDefined()
    expect(successfulFix?.attempt).toBe(2)

    // The issue reaches fixed_pending_review after the retry succeeds, then is closed
    // by closeUnreportedFixed in the follow-up review round that reports no issues.
    const issues = Object.values(ledger.issues)
    expect(issues.length).toBe(1)
    expect(issues[0]?.status).toBe('closed')
  })

  test('--no-inspect skips inspector; fixer valid + build pass → merge', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'review-loop-no-inspect-'))
    tempDirs.push(dir)

    const repoPath = path.join(dir, 'repo')
    await initRepo(repoPath, { 'src/queue.ts': 'export const queue = []\n' })

    const { runRoot, runId, summary, trace, ledger } = await runFakeScenario({
      dir,
      poolSize: 1,
      noInspect: true,
      makeFixerChanges: true,
      reviewerIssues: [
        JSON.stringify({ issues: [buildIssue({ title: 'Race condition', severity: 'high', file: 'src/queue.ts' })] }),
        JSON.stringify({ issues: [] }),
      ],
      fixerResults: [buildFixerResult()],
    })

    expect(summary).toContain('Review loop finished: done')
    expect(trace.some((e) => e.event === 'inspect_complete')).toBe(false)
    expect(existsSync(path.join(runRoot, runId, 'inspect.json'))).toBe(false)

    const fixEvents = trace.filter((e) => e.event === 'fix_complete')
    expect(fixEvents.length).toBe(1)
    expect(fixEvents[0]?.fixed).toBe(true)
    expect(fixEvents[0]?.attempt).toBe(1)

    const issues = Object.values(ledger.issues)
    expect(issues.length).toBe(1)
    expect(issues[0]?.status).toBe('closed')

    const { execFileSync } = await import('node:child_process')
    const commitCount = Number(
      execFileSync('git', ['-C', repoPath, 'rev-list', '--count', 'main'], { encoding: 'utf8' }).trim(),
    )
    // init commit + 1 fix commit
    expect(commitCount).toBeGreaterThanOrEqual(2)
  })
})
