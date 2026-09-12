// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'

import { blockGitBranchCreate } from '../../.hooks/git/checks/block-git-branch-create.mjs'
import { blockGitCheckoutDiscard } from '../../.hooks/git/checks/block-git-checkout-discard.mjs'
import { blockGitCheckout } from '../../.hooks/git/checks/block-git-checkout.mjs'
import { blockGitReset } from '../../.hooks/git/checks/block-git-reset.mjs'
import { blockGitRm } from '../../.hooks/git/checks/block-git-rm.mjs'
import { blockGitStash } from '../../.hooks/git/checks/block-git-stash.mjs'
import { blockGitSwitch } from '../../.hooks/git/checks/block-git-switch.mjs'

try {
  /** @type {{ tool_name?: string, tool_input: Record<string, unknown> }} */
  const ctx = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))

  const checks = [
    blockGitStash,
    blockGitCheckoutDiscard,
    blockGitReset,
    blockGitRm,
    blockGitSwitch,
    blockGitCheckout,
    blockGitBranchCreate,
  ]
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
