// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'

import { createEnvelope } from '../prompts.js'
import type { UntrustedEnvelope } from '../prompts.js'

/**
 * Mints the untrusted-input envelope for one prompt.
 *
 * Random, not derived. It used to be `issueId-revision-attempts+ciAttempts`,
 * justified as unguessable because "issue authors cannot see the state block's
 * revision counter before the prompt is built" — which is false. The agent posts
 * that state block, in plain text, in the very thread the attacker is writing
 * into, so anyone commenting second reads every component; and on a fresh issue
 * the whole id collapses to `<number>-0-00`.
 *
 * One envelope per prompt, created by the caller and passed to *both* the system
 * prompt and the user prompt, because the rule the system prompt states and the
 * terminator the user prompt uses have to name the same id.
 */
export const mintEnvelope = (): UntrustedEnvelope => createEnvelope(randomUUID())
