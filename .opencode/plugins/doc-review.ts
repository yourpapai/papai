import type { Plugin } from '@opencode-ai/plugin'

import { buildDocReviewPrompt } from '../../.hooks/docs/build-doc-review-prompt.mjs'
import { mapFilesToDocs } from '../../.hooks/docs/map-files-to-docs.mjs'
import { trackSourceWrite } from '../../.hooks/docs/track-source-write.mjs'
import { getSessionsDir } from '../../.hooks/tdd/paths.mjs'
import { SessionState } from '../../.hooks/tdd/session-state.mjs'

const EDIT_TOOLS = new Set(['write', 'edit', 'multiedit'])

export const DocReview: Plugin = async ({ client, directory }) => {
  let currentSessionID = ''

  return {
    'tool.execute.after': async (input) => {
      currentSessionID = input.sessionID

      if (!EDIT_TOOLS.has(input.tool)) return

      const filePath = input.args['filePath'] as string
      if (!filePath) return

      if (!trackSourceWrite(filePath)) return

      const state = new SessionState(input.sessionID, getSessionsDir(directory))
      state.addChangedSourceFile(filePath)
    },

    'session.idle': async () => {
      const sessionID = currentSessionID
      if (!sessionID) return

      const state = new SessionState(sessionID, getSessionsDir(directory))
      if (state.getDocReviewSuggested()) return

      const changedFiles = state.getChangedSourceFiles()
      if (changedFiles.length === 0) return

      const docPaths = mapFilesToDocs(changedFiles)
      const prompt = buildDocReviewPrompt(changedFiles, docPaths)

      state.setDocReviewSuggested(true)

      void client.session.promptAsync({
        path: { id: sessionID },
        body: {
          parts: [{ type: 'text', text: prompt }],
        },
      })
    },
  }
}
