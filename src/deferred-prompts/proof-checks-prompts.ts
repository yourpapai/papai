// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import { getContextLanguage } from '../utils/config-language.js'
import { getUserTimezoneOrError } from '../utils/config-timezone.js'
import { localDatetimeToUtc, utcToLocal } from '../utils/datetime.js'
import type { CreateDeliveryContext } from './delivery-input.js'
import { appendProofJsonLine, type ProofCheckRecord, type ProofVerdict } from './proof-store.js'
import { proofMarker, proofMarkerSentence } from './proof-checks.js'
import type { CreateInput, UpdateInput } from './tool-handlers.js'
import type {
  AlertCondition,
  AlertPrompt,
  CancelResult,
  CreateResult,
  GetResult,
  ScheduledPrompt,
  UpdateResult,
} from './types.js'
import type { ProofCheckDeps, ProofCheckId, ProofCheckRequest } from './proof-checks.js'

const log = undefined as never

const MINUTE_MS = 60_000
const MARKER_PREFIX = '[[proof-check:'
export const SCHEDULED_POLL_MS = 60_000
const ALERT_POLL_MS = 5 * MINUTE_MS
const WINDOW_CAP_MS = 15 * MINUTE_MS
const MIN_WINDOW_MS = 1_000
export const FIRE_AT_LEAD_MS = 90_000
export const BUG3_FIRE_AT_LEAD_MS = 10 * MINUTE_MS
const PROOF_PROMPT_BODY =
  'Proof-check probe: reply in one short turn and echo the marker sentence from the delivery brief verbatim; do not call any tools.'
const PROBE_URL = 'http://127.0.0.1:9/proof-check-probe'
const PROOF_CONDITION_NEVER_VALUE = '__proof_check_never__'
