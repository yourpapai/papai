# Analytics: allow 'edit' source family in epoch_source_counters CHECK

## Goal
Stop the canonical insert path from failing its transaction with a SQLite CHECK violation on the first `edit_classified`/`edit_regen` event under `local_pseudonymous`. Today that insert fails the whole sink batch (observer_failure, events dropped).

## Root cause (verified in code)
- `src/analytics/governance/collection-serialization.ts:45` adds `'edit'` to `SOURCE_FAMILIES`; lines 79–80 map `edit_classified`/`edit_regen` → `'edit'`.
- `insertFenced` (same file, lines 200–228) bumps `analytics_epoch_source_counters` with that family for dispositions `opportunity`/`canonical` (and `governance_ineligible` on the not-eligible path) via `incrementCounterTx`.
- Migration 072's CHECK (`src/db/migrations/072_analytics_foundation.ts:157-163`) lists 22 families and omits `'edit'`; no later migration amends it (latest is 078).
- Aggregate lane unaffected: it uses the fixed `'chat'` family (see 078), which is why `local_aggregate` never tripped this.

## Files to touch
1. **New** `src/db/migrations/079_edit_source_family_check.ts` — SQLite table rebuild (pattern from 044/062/023):
   - `DROP TABLE IF EXISTS analytics_epoch_source_counters_new`
   - create `_new` with DDL byte-identical to 072's `analytics_epoch_source_counters` (epoch_id FK → `analytics_process_epochs(epoch_id)` ON DELETE RESTRICT, dispositions CHECK, value CHECK, composite PK) **except** `'edit'` added to the `source_family` CHECK list;
   - `INSERT INTO ... SELECT` all columns/rows from the old table;
   - `DROP TABLE analytics_epoch_source_counters`; `ALTER TABLE ... RENAME TO`.
   - Runs inside the migration transaction (`src/db/migrate.ts:117`); production connection has `PRAGMA foreign_keys=ON` (`src/db/index.ts:112`) so the copy validates the epoch FK — rows all reference existing epochs.
2. `src/db/index.ts` — import and append `migration079EditSourceFamilyCheck` to `MIGRATIONS` (list ends at line 204 with 078).
3. `src/analytics/governance/collection-serialization.ts` — export the existing `SOURCE_FAMILIES` const (no behavior change) so tests can assert parity.
4. **New** `tests/db/migrations/079_edit_source_family_check.ts` (test-only counterpart of the migration).

## Behavior change
After migration 079, inserting an epoch source counter row with `source_family = 'edit'` succeeds; existing rows are preserved exactly; all other constraints remain enforced. Fresh DBs get the widened CHECK via 072→079; existing DBs rebuild in place. `setupTestDb()`'s snapshot cache keys on the migration set, so it picks this up automatically.

## Non-goals
- No remapping of edit events to an existing family (weaker; family map is per-registry and intentional).
- No historical repair/backfill: every prior edit-event canonical insert failed wholesale, so no edit rows/counters exist to repair; the aggregate lane needs nothing.
- No changes to the drizzle schema (`src/db/analytics-schema.ts` has no family CHECK).

## Verification
New migration test (follow the 062 filter pattern: `runMigrations(db, MIGRATIONS.filter(m => m.id !== '079_...'))`, then apply 079):
- seed one epoch + counter rows across families/dispositions; after 079, rows preserved exactly (copy integrity) and inserting `('edit','canonical')` succeeds;
- a bogus family still throws (CHECK still effective);
- `PRAGMA foreign_key_check` returns no rows after rebuild, with `foreign_keys=ON` enabled on the test connection to mirror production;
- **parity regression test**: after full `MIGRATIONS`, every value in the exported `SOURCE_FAMILIES` inserts cleanly — a future family added to the map without a migration fails CI instead of the sink.
Then `bun run test` (full suite; migration tests + analytics suites) and `bun check:full`. The new migration file will be mutation-measured by `test:mutate:changed` on the PR; the tests above exercise copy/reject/accept paths to cover it.
