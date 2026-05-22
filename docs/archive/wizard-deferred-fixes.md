<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Wizard — Deferred Fixes

## 1. Fix masking — reuse `maskValue` from `config.ts`

**File:** `src/wizard/steps.ts:122-134`

The local `maskValue` shows the first 4 and last 4 characters for keys longer than 8 chars, and shows short keys in full. The existing `maskValue(key, value)` in `src/config.ts` correctly masks all sensitive keys with `****last4` regardless of length.

**Fix:** Remove the local `maskValue` and `getMaskedValue` functions. Import and use `maskValue` from `config.ts`. Update `formatSummary` to pass the key:

```typescript
import { maskValue } from '../config.js'

function getDisplayValue(key: string, value: string | undefined): string {
  if (value === undefined || value === '') return 'Not set'
  if (['llm_apikey', 'kaneo_apikey', 'youtrack_token'].includes(key)) {
    return maskValue(key as ConfigKey, value)
  }
  return value
}
```

Then update all lines in `formatSummary` that call `getMaskedValue(...)` to call `getDisplayValue(key, ...)` instead.

---

## 2. Step progress indicator

**File:** `src/wizard/engine.ts:52-60` (`getNextPrompt`)

Users don't know how many steps remain during the wizard. The session already has `currentStep` and `totalSteps`.

**Fix:** Prepend step progress to each prompt:

```typescript
function getNextPrompt(userId: string, storageContextId: string): string {
  const session = getWizardSession(userId, storageContextId)
  if (session === null) return 'Error: Wizard session not found'

  const step = getStepByIndex(session.taskProvider, session.currentStep)
  if (step === undefined) return 'Error: Invalid step index'

  return `(${session.currentStep + 1}/${session.totalSteps}) ${step.prompt}`
}
```

---

## 3. Session TTL

**File:** `src/wizard/state.ts`

Abandoned wizard sessions live in memory forever. Add a 30-minute TTL with eviction on access.

**Fix:** Add TTL constant and eviction in `getWizardSession`:

```typescript
const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes

export const getWizardSession = (userId: string, storageContextId: string): WizardSession | null => {
  const key = createSessionKey(userId, storageContextId)
  const session = activeSessions.get(key)

  if (session !== undefined && Date.now() - session.startedAt.getTime() > SESSION_TTL_MS) {
    activeSessions.delete(key)
    logger.info({ userId, storageContextId }, 'Wizard session expired')
    return null
  }

  logger.debug({ userId, storageContextId, hasSession: session !== undefined }, 'Getting wizard session')

  return session ?? null
}
```

Apply the same TTL check in `hasActiveWizard`.
