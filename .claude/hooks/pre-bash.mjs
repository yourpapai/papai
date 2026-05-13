import fs from 'node:fs'

import { blockGitCheckoutDiscard } from '../../.hooks/git/checks/block-git-checkout-discard.mjs'
import { blockGitStash } from '../../.hooks/git/checks/block-git-stash.mjs'

try {
  const ctx = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))

  const checks = [blockGitStash, blockGitCheckoutDiscard]
  for (const check of checks) {
    const result = check(ctx)
    if (result) {
      console.log(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: result.reason,
          },
        }),
      )
      break
    }
  }
} catch {
  // Fail open
}

process.exit(0)
