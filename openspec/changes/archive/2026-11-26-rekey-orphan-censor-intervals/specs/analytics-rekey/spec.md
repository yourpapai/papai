## Purpose

Guarantees per-actor withdrawal/deletion censor evidence survives HMAC rekey even when the actor has zero retained canonical events.

## ADDED Requirements

### Requirement: Orphan censor intervals survive rekey

The system SHALL copy every source `analytics_censor_intervals` row to the target generation remapped to the target actor key, including rows whose actor has no source parent event.

#### Scenario: Fully withdrawn actor rekeys clean

- **WHEN** a rekey runs with a `v1` censor interval whose actor has zero `gen-1` canonical events
- **THEN** a `v2` interval for the remapped actor exists and `verify` reports `content_ok=true`

#### Scenario: Mixed actors all conserved

- **WHEN** a rekey runs with event-backed and orphan censor rows
- **THEN** every source interval has exactly one remapped target counterpart and no extras exist

### Requirement: Content verify matches copy scope

The system SHALL classify `censor_intervals` in content verification the same way copy does, so a copied state always verifies.

#### Scenario: Verify after orphan copy

- **WHEN** copy has mirrored all source intervals including orphans
- **THEN** `verifyMappingNormalizedContentIn` returns `ok=true` with zero `censor_intervals` mismatches
