// .opencode/plugins/tdd-enforcement.ts
// OpenCode plugin TDD enforcement following ADR-0070: Silent PostToolUse + Stop-Gated Full Check
// Delegates to .hooks/tdd/checks/* for all check implementations
//
// NOTE: session.idle is used because OpenCode does not provide a blocking session.stop hook.
// The full check runs after the agent loop breaks and sends a follow-up prompt on failure.

import type { Plugin } from '@opencode-ai/plugin'

import { blockGitCheckoutDiscard } from '../../.hooks/git/checks/block-git-checkout-discard.mjs'
import { blockGitStash } from '../../.hooks/git/checks/block-git-stash.mjs'
import { checkFull } from '../../.hooks/tdd/checks/check-full.mjs'
import { enforceTdd } from '../../.hooks/tdd/checks/enforce-tdd.mjs'
import { enforceWritePolicy } from '../../.hooks/tdd/checks/enforce-write-policy.mjs'
import { trackTestWrite } from '../../.hooks/tdd/checks/track-test-write.mjs'
import { verifyTestImport } from '../../.hooks/tdd/checks/verify-test-import.mjs'
import { getSessionBaseline } from '../../.hooks/tdd/coverage-session.mjs'
import { getSessionsDir } from '../../.hooks/tdd/paths.mjs'
import { SessionState } from '../../.hooks/tdd/session-state.mjs'

// OpenCode edit tools that use filePath
const EDIT_TOOLS = new Set(['write', 'edit', 'multiedit'])

export const TddEnforcement: Plugin = async ({ client, directory }) => {
  // Track active session ID across tool events so session.idle has the correct ID
  let currentSessionID = ''

  return {
    // PRE-WRITE HOOK (runs before Write/Edit/MultiEdit)
    'tool.execute.before': async (input, output) => {
      // Capture session ID from every tool call so session.idle always knows it
      currentSessionID = input.sessionID

      // Block destructive git commands regardless of tool type
      if (input.tool === 'bash') {
        const command = (output.args?.command as string) ?? ''
        const gitStashResult = blockGitStash({ tool_name: 'bash', tool_input: { command } })
        if (gitStashResult) throw new Error(gitStashResult.reason)
        const gitCheckoutResult = blockGitCheckoutDiscard({ tool_name: 'bash', tool_input: { command } })
        if (gitCheckoutResult) throw new Error(gitCheckoutResult.reason)
      }

      // Only process edit tools
      if (!EDIT_TOOLS.has(input.tool)) return

      const toolArgs = output.args as Record<string, unknown>
      const filePath = toolArgs['filePath'] as string
      if (!filePath) return

      const ctx = {
        tool_name: input.tool,
        tool_input: { ...toolArgs, file_path: filePath },
        session_id: input.sessionID,
        cwd: directory,
      }

      // [0] enforceWritePolicy - Block protected config edits and inline suppressions
      const writePolicyResult = enforceWritePolicy(ctx)
      if (writePolicyResult) {
        throw new Error(writePolicyResult.reason)
      }

      // Capture coverage baseline BEFORE any edits to ensure it reflects the
      // pre-edit state, not the state after the first edit (fixes lazy capture bug)
      getSessionBaseline(input.sessionID, directory)

      // [1] enforceTdd - Block impl writes without test
      const tddResult = enforceTdd(ctx)
      if (tddResult) {
        throw new Error(tddResult.reason)
      }

      // Set needsRecheck flag so Stop hook knows to run full check
      const state = new SessionState(input.sessionID, getSessionsDir(directory))
      state.setNeedsRecheck(true)
    },

    // POST-WRITE HOOK (runs after Write/Edit/MultiEdit)
    'tool.execute.after': async (input) => {
      currentSessionID = input.sessionID

      if (!EDIT_TOOLS.has(input.tool)) return

      const filePath = input.args['filePath'] as string
      if (!filePath) return

      // Delegate to hook checks with OpenCode-compatible context shape
      const ctx = {
        tool_input: { file_path: filePath },
        session_id: input.sessionID,
        cwd: directory,
      }

      // [4] trackTestWrite - Record test files written this session
      trackTestWrite(ctx)

      // [5] verifyTestImport - Verify test files import their implementation module
      const importResult = verifyTestImport(ctx)
      if (importResult) {
        void client.session.promptAsync({
          path: { id: input.sessionID },
          body: {
            parts: [{ type: 'text', text: importResult.reason }],
          },
        })
        return
      }

      // Note: verifyTestsPass and verifyNoNewSurface were removed from post-write
      // They now run in the Stop hook instead (ADR-0070)
    },

    // IDLE HOOK (runs when session becomes idle - after agent stops)
    // Note: OpenCode does not currently support blocking agent stop.
    // See: https://github.com/anomalyco/opencode/issues/16626
    // The check still runs to surface issues to the user.
    'session.idle': async () => {
      const sessionID = currentSessionID
      const state = new SessionState(sessionID, getSessionsDir(directory))

      // If needsRecheck is false, LLM was blocked and did nothing → skip check
      if (!state.getNeedsRecheck()) {
        state.setNeedsRecheck(true)
        return
      }

      // Run full check
      const result = checkFull({ cwd: directory, session_id: sessionID })

      if (result) {
        // Cannot block here, but we can notify via prompt
        // Note: session.idle runs after the loop breaks, so this creates a follow-up
        void client.session.promptAsync({
          path: { id: sessionID },
          body: {
            parts: [{ type: 'text', text: result.reason }],
          },
        })
        state.setNeedsRecheck(false)
        return
      }

      // All checks passed
      state.setNeedsRecheck(true)
    },
  }
}
