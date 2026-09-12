// Blocks any bash command containing `git switch`
//
// `git switch` exists only to move HEAD to another branch/ref — there is no
// read-only form worth keeping. Other agents or subagents may be working in
// the same tree in parallel; moving HEAD disrupts them. Instead, create a git
// worktree so the current tree is left untouched:
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
export function blockGitSwitch(ctx) {
  const toolName = (ctx.tool_name ?? '').toLowerCase()
  if (toolName !== 'bash') return null

  const command = typeof ctx.tool_input.command === 'string' ? ctx.tool_input.command : ''
  if (/\bgit\s+switch\b/u.test(command)) {
    return {
      decision: 'block',
      reason:
        'git switch is not allowed — it moves HEAD and disrupts other agents working in this tree. Instead, create a worktree: git worktree add ../papai-<desc> -b tmp/<desc>',
    }
  }

  return null
}
