import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { runCli } from '../../review-loop/src/cli.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('review-loop fake integration', () => {
  test('writes summary, transcript, and session files for a clean fake-agent run', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'review-loop-integration-'))
    tempDirs.push(dir)

    const reviewerScenarioPath = path.join(dir, 'reviewer.json')
    const fixerScenarioPath = path.join(dir, 'fixer.json')
    const configPath = path.join(dir, 'config.json')
    const planPath = path.join(dir, 'plan.md')

    writeFileSync(planPath, '# Implementation plan\n')
    writeFileSync(
      reviewerScenarioPath,
      JSON.stringify(
        {
          availableCommands: [{ name: 'review-code', description: 'Review code' }],
          promptReplies: [
            {
              text: '{"round":1,"issues":[{"title":"Race condition in queue flush path","severity":"high","summary":"Two concurrent messages can bypass the intended lock.","whyItMatters":"This can produce stale assistant replies.","evidence":"src/message-queue/queue.ts lines 84-107","file":"src/message-queue/queue.ts","lineStart":84,"lineEnd":107,"suggestedFix":"Take the processing lock earlier.","confidence":0.92}]}',
            },
            { text: '{"round":2,"issues":[]}' },
          ],
        },
        null,
        2,
      ),
    )
    writeFileSync(
      fixerScenarioPath,
      JSON.stringify(
        {
          availableCommands: [
            { name: 'verify-issue', description: 'Verify issue' },
            { name: 'fix-issue', description: 'Fix issue' },
          ],
          promptReplies: [
            {
              text: '{"verdict":"valid","fixability":"auto","reasoning":"The control flow is actually unsafe.","targetFiles":["src/message-queue/queue.ts"],"needsPlanning":false}',
            },
            { text: 'Applied fix.' },
          ],
        },
        null,
        2,
      ),
    )
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          repoRoot: process.cwd(),
          workDir: path.join(dir, '.review-loop'),
          maxRounds: 5,
          maxNoProgressRounds: 2,
          reviewer: {
            command: 'bun',
            args: ['tests/review-loop/fake-agent.ts'],
            env: { ACP_SCENARIO_FILE: reviewerScenarioPath },
            sessionConfig: {},
            invocationPrefix: '/review-code',
            requireInvocationPrefix: true,
          },
          fixer: {
            command: 'bun',
            args: ['tests/review-loop/fake-agent.ts'],
            env: { ACP_SCENARIO_FILE: fixerScenarioPath },
            sessionConfig: {},
            verifyInvocationPrefix: '/verify-issue',
            fixInvocationPrefix: '/fix-issue',
            requireVerifyInvocation: true,
          },
        },
        null,
        2,
      ),
    )

    await runCli(['--config', configPath, '--plan', planPath])

    const runRoot = path.join(dir, '.review-loop', 'runs')
    const runId = readdirSync(runRoot)[0]
    expect(runId).toBeDefined()
    const runDirName = runId!
    const summary = readFileSync(path.join(runRoot, runDirName, 'summary.txt'), 'utf8')
    const reviewerTranscript = readFileSync(path.join(runRoot, runDirName, 'transcripts', 'reviewer.ndjson'), 'utf8')
    const fixerTranscript = readFileSync(path.join(runRoot, runDirName, 'transcripts', 'fixer.ndjson'), 'utf8')
    const reviewerSession = readFileSync(path.join(runRoot, runDirName, 'reviewer-session.json'), 'utf8')

    expect(summary).toContain('Done reason: clean')
    expect(reviewerTranscript).toContain('"sessionUpdate":"agent_message_chunk"')
    expect(reviewerTranscript).toContain(
      '/review-code Review the current implementation against the implementation plan at:',
    )
    expect(reviewerTranscript).toContain(
      '/review-code Re-review the current implementation against the implementation plan at:',
    )
    expect(fixerTranscript).toContain('/verify-issue Verify this issue against the implementation plan at:')
    expect(fixerTranscript).toContain('/fix-issue Fix exactly the verified issue below.')
    expect(reviewerSession).toContain('"sessionId"')
  })
})
