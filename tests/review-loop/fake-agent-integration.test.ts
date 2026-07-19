// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { runCli } from '../../review-loop/src/cli.js'

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

const scenarioPath = process.env.FAKE_OPENCODE_SCENARIO
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'))
const outputPath = extractOutputPath(prompt)

if (prompt.includes('Review the current implementation')) {
  const issues = scenario.reviewerIssues[scenario._reviewerCall ?? 0] ?? '{"issues":[]}'
  scenario._reviewerCall = (scenario._reviewerCall ?? 0) + 1
  writeFileSync(scenarioPath, JSON.stringify(scenario))
  if (outputPath) writeFileSync(outputPath, issues)
} else if (prompt.includes('You are an inspector')) {
  if (outputPath) writeFileSync(outputPath, JSON.stringify({ addresses: true, reasoning: 'mock', confidence: 0.9 }))
} else if (prompt.includes('Verify and fix') || prompt.includes('build error')) {
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
    const { readdirSync } = await import('node:fs')
    const runId = readdirSync(runRoot)[0]
    expect(runId).toBeDefined()
    const summary = readFileSync(path.join(runRoot, runId!, 'summary.txt'), 'utf8')
    expect(summary).toContain('Done reason: clean')
  })
})
