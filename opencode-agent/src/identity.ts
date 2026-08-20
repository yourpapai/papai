// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { GitHubApi } from './github.js'
import type { Logger } from './logger.js'
import { errorMessage } from './types.js'

export interface SelfLoginSources {
  /** `AGENT_SELF_LOGIN`, when an operator pinned one. */
  override: string | null
  /** Who the API says this token is. */
  api: GitHubApi
  log: Logger
}

/**
 * The account the Actions runtime's own `GITHUB_TOKEN` posts as.
 *
 * The last-resort guess, and deliberately not the repository owner. This branch
 * is only ever reached when the token cannot read `/user`, which means it is an
 * installation token — whose author is always some `<app-slug>[bot]` and never
 * a human. The owner therefore had no chance of being right, while this is
 * exactly right for the token the workflow uses by default.
 */
export const DEFAULT_BOT_LOGIN = 'github-actions[bot]'

/**
 * Works out which login the pipeline should treat as its own.
 *
 * This is not cosmetic. `selfLogin` is the **author filter** that
 * `findLatestState` and `findArtifact` read state and artefacts back through, as
 * well as the recursion guard. Set it wrong and nothing matches: every event
 * restores `initialState`, so the issue silently restarts at phase one, forever,
 * with no error anywhere. Defaulting it to the repository owner made that the
 * behaviour whenever the agent posts as anything else — which, for the GitHub
 * App token the README recommends, is always.
 *
 * The order is override, then the token's own identity, then a bot login:
 *
 * 1. An explicit `AGENT_SELF_LOGIN` always wins. An operator who knows the
 *    answer should not be second-guessed, and it is the escape hatch for every
 *    case below. Because it wins outright, the caller must pass it through
 *    *unset* when nobody pinned one — an override defaulted upstream to
 *    something plausible is the exact failure this ladder exists to prevent,
 *    and it silences steps 2 and 3 along with their warning.
 * 2. Otherwise ask the API. For a personal access token this is exact.
 * 3. If that fails, fall back to {@link DEFAULT_BOT_LOGIN} **and say so at
 *    `warn`**. A GitHub App installation token cannot read `/user` — the
 *    identity behind one is `<app-slug>[bot]`, which needs a JWT and a
 *    different endpoint — so this branch is the expected path for an
 *    Actions-issued token, not an exotic error. The warning names
 *    `AGENT_SELF_LOGIN` because that is the fix for every other app slug.
 *
 * Deliberately shaped so correctness does not depend on knowing which token
 * types can answer: it asks, and falls back on any failure.
 */
export const resolveSelfLogin = async (sources: SelfLoginSources): Promise<string> => {
  const { override, log } = sources
  if (override !== null && override.trim().length > 0) return override.trim()

  try {
    const login = (await sources.api.getAuthenticatedLogin()).trim()
    if (login.length === 0) throw new Error('the API returned an empty login')

    log.debug({ login }, 'Derived the agent identity from the token')
    return login
  } catch (error) {
    log.warn(
      { fallback: DEFAULT_BOT_LOGIN, error: errorMessage(error) },
      `Could not read the token identity; assuming ${DEFAULT_BOT_LOGIN}. Set AGENT_SELF_LOGIN if the agent posts as anything else, or its own comments will be unreadable to it.`,
    )
    return DEFAULT_BOT_LOGIN
  }
}

/**
 * Reports an identity that disagrees with the account GitHub actually recorded.
 *
 * The one moment the truth is free: a created comment comes back carrying its
 * author. Before this, a wrong identity produced no signal at all — the next run
 * simply failed to find its own state and started over, which reads as the agent
 * ignoring the conversation rather than as a misconfiguration.
 */
export const reportIdentityDrift = (expected: string, actual: string, log: Logger): void => {
  if (actual.length === 0 || expected.toLowerCase() === actual.toLowerCase()) return

  log.error(
    { expected, actual },
    'The agent posted as a different account than it identifies as. Its own comments will be invisible to it on the next event, restarting this issue from scratch. Set AGENT_SELF_LOGIN to the account it posts as.',
  )
}
