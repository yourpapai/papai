// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { Plugin } from '@opencode-ai/plugin'

import { buildDocReviewPrompt } from '../../.hooks/docs/build-doc-review-prompt.mjs'
import { mapFilesToDocs } from '../../.hooks/docs/map-files-to-docs.mjs'
import { trackSourceWrite } from '../../.hooks/docs/track-source-write.mjs'
import { getSessionsDir } from '../../.hooks/tdd/paths.mjs'
import { SessionState } from '../../.hooks/tdd/session-state.mjs'

const EDIT_TOOLS = new Set(['write', 'edit', 'multiedit'])

const normalizeChangedFilePath = (filePath: string, directory: string): string => {
  if (!path.isAbsolute(filePath)) return filePath
  return path.relative(directory, filePath)
}

export const DocReview: Plugin = ({ client, directory }) => {
  let currentSessionID = ''

  return Promise.resolve({
    'tool.execute.after': (input) => {
      currentSessionID = input.sessionID

      if (!EDIT_TOOLS.has(input.tool)) return Promise.resolve()

      const filePath = input.args['filePath'] as string
      if (!filePath) return Promise.resolve()

      if (!trackSourceWrite(filePath, directory)) return Promise.resolve()

      const state = new SessionState(input.sessionID, getSessionsDir(directory))
      state.addChangedSourceFile(normalizeChangedFilePath(filePath, directory))

      return Promise.resolve()
    },

    event: ({ event }) => {
      if (event.type !== 'session.idle') return Promise.resolve()

      const sessionID = currentSessionID
      if (!sessionID) return Promise.resolve()

      const state = new SessionState(sessionID, getSessionsDir(directory))
      if (state.getDocReviewSuggested()) return Promise.resolve()

      const changedFiles = state.getChangedSourceFiles()
      if (changedFiles.length === 0) return Promise.resolve()

      const docPaths = mapFilesToDocs(changedFiles)
      const prompt = buildDocReviewPrompt(changedFiles, docPaths)

      state.setDocReviewSuggested(true)

      void client.session.promptAsync({
        path: { id: sessionID },
        body: {
          parts: [{ type: 'text', text: prompt }],
        },
      })

      return Promise.resolve()
    },
  })
}
