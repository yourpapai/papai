import { execFileSync } from 'node:child_process'

import { parseCheckOutput } from './parse-check-output.mjs'

/** Checks whose output is a test run, and therefore already indexed in reports/test/. */
const TEST_CHECKS = new Set(['test', 'test:client', 'review-loop:test'])

/** Inline file names before the list is elided; the full set is in the log file. */
const MAX_INLINE_FILES = 5

/** Mirrors `safe_name()` in scripts/check.sh, which names the per-check log file. */
const safeName = (check) => check.replaceAll(':', '_')

/**
 * Where to look, per check. Never "run it again": `scripts/check.sh` has already
 * paid for the run and left the output on disk, so re-running only buys the same
 * bytes at full price — 6 minutes of it, for the test checks.
 */
const pointerFor = (check) =>
  TEST_CHECKS.has(check)
    ? 'bun run test:failures      (report already on disk; do not re-run to look)'
    : `reports/checks/${safeName(check)}.log`

/**
 * `parseCheckOutput` already extracted the offending files out of the captured
 * output; naming them here is what turns "typecheck failed" into a place to
 * start. The list is capped because a broad failure can name hundreds, and the
 * log file holds the complete set either way.
 */
const describeFiles = (check, files) => {
  if (files.length === 0) return `- ${check}`
  const shown = files.slice(0, MAX_INLINE_FILES).join(', ')
  const elided = files.length - MAX_INLINE_FILES
  const suffix = elided > 0 ? ` +${elided} more` : ''
  return `- ${check} (${files.length} file${files.length === 1 ? '' : 's'}) — ${shown}${suffix}`
}

export function formatCheckResult(failures) {
  const lines = failures.flatMap(({ check, files }) => [describeFiles(check, files), `  → ${pointerFor(check)}`])
  return ['`bun check:full` failed:', ...lines].join('\n')
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
