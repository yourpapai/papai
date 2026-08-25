// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { writeFileSync } from 'node:fs'
import path from 'node:path'

import type { ClaudeCredential } from './config-values.js'
import { PipelineError } from './errors.js'

/**
 * The OAuth spelling's credential carrier — the one file-state concern of the
 * claude route, split from `claude-connect.ts` when that file reached
 * `max-lines`. `claude-connect.ts` remains how the CLI is *started and
 * addressed*; this is the token's file-side mechanism alone (design D2).
 */

/** The settings filename the writer emits and the adapter names via `--settings`. */
export const CLAUDE_SETTINGS_FILENAME = 'settings.json'

/**
 * The OAuth spelling cannot ride the environment: under `--bare` the pinned
 * CLI reads only `ANTHROPIC_API_KEY` or its `apiKeyHelper` mechanism, so the
 * subscription token is delivered as the CLI's own sanctioned carrier — a
 * helper script inside the job-scoped config dir plus the settings file
 * naming it. One value, one file: the settings file carries a path only.
 * The pair authenticates nothing until an invocation names the settings
 * file via `--settings` — `--bare` skips config-dir auto-discovery — which
 * is why the adapter, not this writer, composes that flag.
 *
 * The API-key spelling and an absent credential write nothing — env injection
 * is the API key's mechanism, and no credential is the recorder's
 * un-credentialed auth-error leg.
 */
export const writeClaudeCredentialFiles = (
  configDir: string,
  credential: ClaudeCredential | null | undefined,
): void => {
  if (credential === null || credential === undefined || credential.name === 'ANTHROPIC_API_KEY') return
  if (credential.value.includes("'") || credential.value.includes('\n')) {
    throw claudeCredentialFileError(credential.value.includes("'") ? 'a single quote' : 'a newline')
  }

  const helperPath = path.join(configDir, 'credential.sh')
  writeFileSync(helperPath, `#!/bin/sh\nprintf '%s' '${credential.value}'`, { mode: 0o700 })
  writeFileSync(path.join(configDir, CLAUDE_SETTINGS_FILENAME), JSON.stringify({ apiKeyHelper: helperPath }), {
    mode: 0o600,
  })
}

/** The helper script cannot be composed from the token it must carry — said naming the variable, never the value. */
export const claudeCredentialFileError = (reason: string): PipelineError =>
  new PipelineError(
    'CLAUDE_CREDENTIAL_FILE',
    `The CLAUDE_CODE_OAUTH_TOKEN value contains ${reason}, so the \`apiKeyHelper\` script that must echo it cannot be ` +
      'composed safely. The value is never quoted here — a token that cannot ride the helper has no carrier on this ' +
      'route; rotate it for one the CLI issued, or use ANTHROPIC_API_KEY.',
  )
