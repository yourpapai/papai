// Blocks any bash command containing `git rm`
//
// `git rm` removes tracked paths from the tree (and the index). Agents edit
// files through the write tools — the write guard governs those; deleting
// tracked structure outright is not an edit. `git rm` has no read-only form.

/**
 * @typedef {Object} BlockResult
 * @property {'block'} decision
 * @property {string} reason
 */

/**
 * @param {{ tool_name?: string, tool_input: Record<string, unknown> }} ctx
 * @returns {BlockResult | null}
 */
export function blockGitRm(ctx) {
  const toolName = (ctx.tool_name ?? '').toLowerCase()
  if (toolName !== 'bash') return null

  const command = typeof ctx.tool_input.command === 'string' ? ctx.tool_input.command : ''
  if (/\bgit\s+rm\b/u.test(command)) {
    return {
      decision: 'block',
      reason:
        'git rm is not allowed — it removes tracked paths from the tree. Edit or delete files with the write tools instead.',
    }
  }

  return null
}
