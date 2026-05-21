<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0045: End-of-Wizard Validation Instead of Per-Step Live Validation

## Status

Accepted

## Date

2026-03-28

## Context

The wizard configuration system was designed with an initial plan to implement **per-step live validation** - validating API keys, base URLs, and model names immediately as the user enters them at each wizard step. This approach would have:

- Added a `liveCheck` property to `WizardStep` interface
- Made real-time HTTP calls during step advancement
- Shown immediate validation errors before proceeding

However, during implementation review, we identified several issues with this approach.

## Decision Drivers

1. **User Experience**: Per-step validation interrupts the flow of configuration
2. **Network Latency**: HTTP validation at each step would slow down the wizard
3. **Error Handling**: Users may have intermittent connectivity or slow networks
4. **Implementation Complexity**: Per-step validation required significant architecture changes
5. **Existing Infrastructure**: The codebase already had a working end-of-wizard validation system

## Considered Options

### Option 1: Per-Step Live Validation (As Planned)

**Approach**: Validate each configuration value immediately at each step via HTTP calls.

**Pros**:

- Immediate feedback to users
- Prevents accumulation of invalid values
- Catches errors early in the process

**Cons**:

- Network latency delays between every step
- Interrupts user flow with potentially slow HTTP calls
- Requires complex state management to pass credentials between steps
- Users on slow/unstable connections get stuck
- More complex implementation with context passing

**Code Pattern**:

```typescript
// In validateAndStoreValue
if (currentStep.liveCheck !== undefined) {
  const liveResult = await currentStep.liveCheck(value)
  if (!liveResult.success) {
    return `${liveResult.message}\n\n${currentStep.prompt}\n\nPlease try again:`
  }
}
```

### Option 2: End-of-Wizard Validation (Current Implementation)

**Approach**: Collect all values first, then validate everything together before saving.

**Pros**:

- Fast step progression (no network delays)
- Complete validation summary with all errors at once
- Users can see full configuration before validation
- Simpler implementation - validation service is separate from wizard flow
- Works well with intermittent connectivity

**Cons**:

- Users don't get immediate feedback per field
- Must complete wizard to see validation errors
- May need to edit multiple values if multiple validations fail

**Code Pattern**:

```typescript
// In validateWizardConfig (called at end)
export async function validateWizardConfig(config: {
  apiKey: string
  baseUrl: string
  mainModel: string
  smallModel: string
}): Promise<ValidationSummary> {
  const errors: ValidationError[] = []
  // Validate API key, URL, models in parallel batch
  // Return comprehensive error summary
}
```

### Option 3: Hybrid Approach (Background Validation)

**Approach**: Allow step progression while validating in background, show results on summary.

**Pros**:

- Fast step progression
- Validation happens during wizard flow
- Summary shows pre-validated state

**Cons**:

- Complex async state management
- Race conditions between user input and validation
- Unclear UX if validation fails after user moved on
- Overengineering for current needs

## Decision

We will use **Option 2: End-of-Wizard Validation** exclusively.

The `liveCheck` property was removed from `WizardStep` interface and is no longer used. Validation happens via `validateWizardConfig()` at the end of the wizard before saving.

## Rationale

1. **Simplicity**: End-of-wizard validation is already implemented and working
2. **User Flow**: Users can quickly enter values without network delays
3. **Better UX**: Complete summary shows all configuration before validation
4. **Error Aggregation**: See all validation errors at once, not one at a time
5. **Implementation Cost**: Avoids complex context passing between wizard steps

## Consequences

### Positive

- **Fast wizard progression**: No network delays between steps
- **Complete error context**: See all validation issues at once
- **Simpler code**: No `liveCheck` property, no per-step async validation
- **Works offline**: Can fill out wizard offline, validate when connected
- **Atomic validation**: All-or-nothing validation before saving

### Negative

- **Deferred feedback**: Users don't know about invalid values until summary
- **Potential rework**: May need to edit multiple values if validation fails
- **Perception**: Some users may prefer immediate validation feedback

### Mitigations

- Validation summary provides clear, actionable error messages
- Users can use `/setup` to edit configuration after seeing errors
- Input validation (format, required fields) still happens per-step synchronously
- HTTP-based validation only happens at summary stage

## Implementation

### Removed Components

- `WizardStep.liveCheck` property removed from interface
- `liveCheck` parameter removed from `createStep()` function
- 36 lines of tests for `liveCheck` functionality removed

### Kept Components

- `validateLlmApiKey()` - Tests API key against `/models` endpoint
- `validateLlmBaseUrl()` - Tests URL connectivity
- `validateModelExists()` - Verifies model exists in API
- `validateWizardConfig()` - Batch validation at summary stage

### Code Changes

**Before** (planned per-step validation):

```typescript
export interface WizardStep {
  id: string
  key: ConfigKey
  prompt: string
  validate: (value: string) => Promise<string | null>
  liveCheck?: (value: string) => Promise<ValidationResult> // REMOVED
  isOptional?: boolean
}
```

**After** (end-of-wizard validation):

```typescript
export interface WizardStep {
  id: string
  key: ConfigKey
  prompt: string
  validate: (value: string) => Promise<string | null>
  isOptional?: boolean
}
```

## Related Decisions

- ADR-0042: Bot Configuration Wizard UX - Original wizard implementation
- `docs/plans/done/2026-03-27-bot-configuration-ux-implementation.md` - Wizard UX design

## References

- `src/wizard/validation.ts` - Validation service implementation
- `src/wizard/engine.ts:130-131` - Comment explaining decision
- `src/wizard/types.ts` - Updated interface without `liveCheck`
- `tests/wizard/validation.test.ts` - Validation service tests
