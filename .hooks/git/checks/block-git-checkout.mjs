// Blocks any bash command containing `git checkout`
//
// `git checkout` moves HEAD (branch/ref checkout, subsuming the separate
// discard-only check that stays registered) and `git checkout -- <path>`
// discards uncommitted working-tree changes permanently. Agents must not
// destroy work that may have taken significant effort to produce, nor move
// the branch other agents are walking.
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
export function blockGitCheckout(ctx) {
  const toolName = (ctx.tool_name ?? '').toLowerCase()
  if (toolName !== 'bash') return null

  const command = typeof ctx.tool_input.command === 'string' ? ctx.tool_input.command : ''
  if (/\bgit\s+checkout\b/u.test(command)) {
    return {
      decision: 'block',
      reason:
        'git checkout is not allowed — it moves HEAD or discards work permanently. Other agents may be working in this tree. Instead, create a worktree: git worktree add ../papai-<desc> -b tmp/<desc>',
    }
  }

  return null
}
