import { execFileSync } from 'node:child_process'

import { parseCheckOutput } from './parse-check-output.mjs'

export function formatCheckResult(failures) {
  const checks = failures.map(({ check }) => `- ${check}`)
  const reruns = failures.map(({ check }) => `bun run ${check}`)
  return [
    '`bun check:full` failed with the following failed checks:',
    ...checks,
    '',
    'Fix the failed check(s), then rerun:',
    ...reruns,
  ].join('\n')
}

export function checkFull(ctx, skipTests = false) {
  try {
    const { cwd } = ctx
    const args = ['run', 'check:full']
    if (skipTests) args.push('--skip-tests')
    execFileSync('bun', args, {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 300_000,
    })
    return null
  } catch (err) {
    const output = err instanceof Error && 'stdout' in err ? (err.stdout ?? '') : ''
    const stderr = err instanceof Error && 'stderr' in err ? (err.stderr ?? '') : ''
    const rawOutput = output || stderr || (err instanceof Error ? err.message : String(err))

    const failures = parseCheckOutput(rawOutput)
    if (failures) {
      return {
        decision: 'block',
        reason: formatCheckResult(failures),
      }
    }

    return {
      decision: 'block',
      reason: '`bun check:full` failed. Run it for details.',
    }
  }
}
