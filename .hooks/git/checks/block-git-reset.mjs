// Blocks any bash command containing `git reset`
//
// `git reset` moves HEAD and unwinds history (`--hard` also destroys working-tree
// work). Agents must not move the branch the runner walks — a C9 implementer
// reset the branch to baseline mid-walk and deleted the change folder; recovery
// needed reflog surgery. Every reset mode is blocked: there is no read-only reset.
//
// Other agents or subagents may be working in the same tree in parallel.
// Do NOT switch branches in-place — that changes HEAD and disrupts them.
// Instead, create a git worktree so the current tree is left untouched:
//
//   git worktree add ../papai-<descriptive-suffix> -b tmp/<descriptive-suffix>

/**
 * @typedef {Object} BlockResult
 * @property {'block'} decision
 * @property {string} reason
 */

/**
 * @param {{ tool_name?: string, tool_input: Record<string, unknown> }} ctx
 * @returns {BlockResult | null}
 */
export function blockGitReset(ctx) {
  const toolName = (ctx.tool_name ?? '').toLowerCase()
  if (toolName !== 'bash') return null

  const command = typeof ctx.tool_input.command === 'string' ? ctx.tool_input.command : ''
  if (/\bgit\s+reset\b/u.test(command)) {
    return {
      decision: 'block',
      reason:
        'git reset is not allowed — it moves HEAD and history. Other agents may be working in this tree. Instead, create a worktree: git worktree add ../papai-<desc> -b tmp/<desc>',
    }
  }

  return null
}
