import { execFileSync } from 'node:child_process'

import { parseCheckOutput } from './parse-check-output.mjs'

export function formatCheckResult(failures) {
  return failures.map(({ check }) => `- ${check} -> rerun: bun run ${check}`).join('\n')
}

export function checkFull(ctx) {
  try {
    const { cwd } = ctx
    execFileSync('bun', ['run', 'check:full'], {
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
