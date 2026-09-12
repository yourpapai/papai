// Blocks `git branch` in its creation form only
//
// `git branch <name>` creates a branch — structure churn mid-walk (a C9
// implementer created `agent/issue-42` next to deleting the change folder).
// Creation is the form whose first token after `git branch` is a non-flag
// argument. Forms carrying a leading flag stay allowed: read-only listing
// (`git branch`, `git branch -a`, `--list`, `--show-current`) and branch
// deletion/rename (`-d`, `-D`, `-m`) — deleting a wrong branch is recoverable
// and sometimes the fix.

/**
 * @typedef {Object} BlockResult
 * @property {'block'} decision
 * @property {string} reason
 */

/**
 * @param {{ tool_name?: string, tool_input: Record<string, unknown> }} ctx
 * @returns {BlockResult | null}
 */
export function blockGitBranchCreate(ctx) {
  const toolName = (ctx.tool_name ?? '').toLowerCase()
  if (toolName !== 'bash') return null

  const command = typeof ctx.tool_input.command === 'string' ? ctx.tool_input.command : ''
  if (/\bgit\s+branch[ \t]+[^-\s]/u.test(command)) {
    return {
      decision: 'block',
      reason:
        'git branch <name> creation is not allowed — branch churn mid-walk disrupts the runner. Listing and deletion forms (git branch -a, -d) stay allowed.',
    }
  }

  return null
}
