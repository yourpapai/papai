// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export default {
  options: {
    tsConfig: 'tsconfig.json',
    exclude: { path: ['^tests/', '^review-loop/', '^docs/architecture/', '^client/stories/'] },
    doNotFollow: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled'] },
    includeOnly: {
      path: [
        '^src/chat/',
        '^src/bot\\.ts',
        '^src/llm-orchestrator',
        '^src/system-prompt\\.ts',
        '^src/ai-progress-reporter\\.ts',
        '^src/ai-output-settings\\.ts',
        '^src/tools/',
        '^src/providers/',
        '^src/plugins/',
        '^src/attachments/',
        '^src/bot-attachments\\.ts',
        '^src/message-queue/',
        '^src/instances/',
        '^src/identity/',
        '^src/deferred-prompts/',
        '^src/recurring',
        '^src/recurrence',
        '^src/recurring\\.ts',
        '^src/scheduler',
        '^src/memory',
        '^src/memos\\.ts',
        '^src/history\\.ts',
        '^src/conversation\\.ts',
        '^src/mcp/',
        '^src/web/',
        '^src/settings/',
        '^src/debug/',
        '^src/stats/',
        '^src/usage/',
        '^client/settings/',
        '^client/admin/',
        '^client/debug/',
      ],
    },
  },
}
