// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Env, PipelineConfig } from './config.js'

/**
 * A value short enough that it could plausibly collide with an unrelated
 * setting. Real provider keys and GitHub tokens are far longer.
 */
const MIN_SECRET_LENGTH = 12

/**
 * Removes the loaded credentials from an environment map, returning the names
 * it removed.
 *
 * `createOpencodeServer` spawns `opencode serve` with `{ ...process.env }` and
 * exposes no environment option, so every variable this process holds is
 * readable by the model's own `bash` tool — `echo $GITHUB_TOKEN` is all it
 * takes. Nothing downstream needs them there: the provider key reaches OpenCode
 * through `OPENCODE_CONFIG_CONTENT`, the GitHub token reaches Octokit through
 * the config object, and git reads its credentials from `.git/config`.
 *
 * Matched by **value**, not by name. The same secret is routinely exported under
 * more than one name, and a name list would silently rot the moment a workflow
 * added an alias — the value is the thing that must not survive.
 */
export const scrubSecrets = (env: Env, secrets: readonly string[]): string[] => {
  const targets = new Set(secrets.filter((secret) => secret.length >= MIN_SECRET_LENGTH))
  if (targets.size === 0) return []

  const removed = Object.keys(env).filter((key) => {
    const value = env[key]
    return value !== undefined && targets.has(value)
  })
  // `Reflect.deleteProperty` rather than `delete env[key]`: the repo forbids
  // dynamic deletes, and assigning `undefined` to a `process.env` key stores the
  // literal string "undefined" instead of removing it.
  for (const key of removed) Reflect.deleteProperty(env, key)

  return removed
}

/** Stand-in for a removed secret. Conspicuous on purpose. */
const REDACTION = '[redacted]'

/**
 * Replaces every occurrence of a loaded credential with a placeholder.
 *
 * Keyed on **values**, like {@link scrubSecrets}, and for a sharper reason: the
 * logger redacts by field name, which only works when a secret arrives in a
 * field somebody named. Check output, git stderr and model prose are free text —
 * a token inside them has no key at all, and the platform does not mask an issue
 * comment the way it masks an Actions log.
 */
export const redactSecrets = (text: string, secrets: readonly string[]): string =>
  secrets.reduce(
    (redacted, secret) => (secret.length >= MIN_SECRET_LENGTH ? redacted.replaceAll(secret, REDACTION) : redacted),
    text,
  )

/**
 * Every credential the pipeline holds, in one place.
 *
 * Both consumers read from here — the environment scrub and the outbound
 * redaction — so a credential added to the config cannot be wired into one and
 * forgotten by the other.
 */
export const pipelineSecrets = (config: PipelineConfig): readonly string[] => [
  config.githubToken,
  config.openai.apiKey,
  // The transcript key, re-encoded to the base64 the environment holds: the
  // scrub and the redaction match by value, and a credential stored as bytes
  // would otherwise survive both.
  ...(config.logKey === null ? [] : [Buffer.from(config.logKey).toString('base64')]),
]
