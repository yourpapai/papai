<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0010: Drizzle ORM for Database Access

## Status

Accepted

## Date

2025-03-20

## Context

The papai codebase originally used raw SQL strings via Bun's `bun:sqlite` `Database` API for all database operations. This was spread across `src/users.ts`, `src/cache-db.ts`, `src/history.ts`, and `src/memory.ts`. Raw SQL brought several problems: no compile-time type safety on query results, schema definition fragmented across seven migration files with no single source of truth, and query strings that could silently break when columns were renamed or tables changed. As the number of database-backed operations grew (user auth, per-user config, conversation history, memory facts, workspace linking), the maintenance cost of untyped SQL became a meaningful friction point.

## Decision Drivers

- All database query results were typed as `unknown` or required manual casting, producing a class of runtime errors that TypeScript could not catch.
- Schema was only defined in migration SQL strings; there was no authoritative TypeScript representation of table structure.
- Refactoring column names required updating multiple disconnected SQL strings with no compiler assistance.
- The project already committed to strict TypeScript (`tsconfig.json` strict mode + all safety flags), making untyped database access an inconsistency.
- The migration must be zero-downtime: existing SQLite database files must continue to work without a data migration.

## Considered Options

### Option 1: Keep raw SQL with typed result wrappers

- **Pros**: No new dependency; team already knows the pattern; migrations stay as plain SQL.
- **Cons**: Type safety remains a manual concern; schema definition stays fragmented; query errors caught only at runtime.

### Option 2: Drizzle ORM with bun-sqlite adapter

- **Pros**: Single `src/db/schema.ts` file defines all tables with full TypeScript types; query builder is type-safe end-to-end; `drizzle-kit` can generate and introspect migrations; compatible with Bun's native SQLite; lightweight with no connection-pool overhead.
- **Cons**: Adds `drizzle-orm` runtime dependency and `drizzle-kit` dev dependency; team must learn Drizzle query builder API; existing migrations must be preserved alongside Drizzle schema.

### Option 3: Another ORM (Prisma, TypeORM, Kysely)

- **Pros**: Prisma and TypeORM have larger ecosystems; Kysely is type-safe SQL builder.
- **Cons**: Prisma requires a separate binary and does not support Bun SQLite natively; TypeORM is heavyweight for a single-file SQLite database; Kysely lacks schema-first migration tooling. Drizzle has first-class Bun SQLite support.

## Decision

Migrate all raw SQL database access to Drizzle ORM using the `drizzle-orm/bun-sqlite` adapter. Define the authoritative schema in `src/db/schema.ts`. Keep the existing custom migration runner (`src/db/migrate.ts`) intact — Drizzle is layered on top of the same SQLite file rather than replacing the migration system.

## Rationale

Drizzle was the only option that satisfies all three constraints simultaneously: (1) first-class Bun SQLite support without a native binary, (2) schema-first TypeScript type generation, and (3) zero data migration for existing deployments. The decision to keep the existing migration runner alongside Drizzle (rather than adopting `drizzle-kit migrate`) avoids a risky cutover for existing production databases and preserves the existing seven migration files as the source of truth for schema history.

## Consequences

### Positive

- All database query results are fully typed; TypeScript catches column name mismatches at compile time.
- `src/db/schema.ts` is the single source of truth for table structure.
- `INSERT ... ON CONFLICT DO UPDATE` patterns are expressed as type-safe builder calls instead of raw SQL strings.
- Adding indexes is now declared in schema and verified by the TypeScript compiler.
- Test isolation improved: `_setDrizzleDb` and `_resetDrizzleDb` helpers in `src/db/drizzle.ts` allow injecting an in-memory database in tests without patching global state.

### Negative

- `drizzle-orm` is a new runtime dependency; bundle size increases slightly (though not relevant for a server-side Bun process).
- Two database abstraction layers coexist: the raw Bun SQLite `Database` instance (used only in `src/db/index.ts` for migrations) and the Drizzle client (used everywhere else). Developers must know which layer to use for which purpose.
- Drizzle query builder syntax is unfamiliar to developers accustomed to raw SQL; ramp-up time required.

## Implementation Status

**Status**: Implemented

Evidence:

- `src/db/schema.ts` — Drizzle schema definitions for all seven tables (`users`, `userConfig`, `conversationHistory`, `memorySummary`, `memoryFacts`, `versionAnnouncements`) with indexes.
- `src/db/drizzle.ts` — Singleton Drizzle client wrapper; includes `_setDrizzleDb` and `_resetDrizzleDb` for test injection.
- `src/users.ts` — imports `eq`, `or` from `drizzle-orm` and `getDrizzleDb` from `./db/drizzle.js`.
- `src/cache-db.ts` — imports `eq`, `and`, `sql` from `drizzle-orm` and `getDrizzleDb`.
- `src/history.ts` — imports `eq` from `drizzle-orm`; `clearHistory` uses Drizzle delete.
- `src/memory.ts` — imports `eq` from `drizzle-orm`; `clearSummary` and `clearFacts` use Drizzle delete.
- `package.json` — `drizzle-orm@^0.45.1` listed in `dependencies`; `drizzle-kit` in `devDependencies`.
- The plan also called for `src/db/migrate-to-drizzle.ts` (a one-time metadata helper); this file is not present in the codebase, indicating the Drizzle metadata table approach was not needed or was handled differently.

## Related Plans

- `/Users/ki/Projects/experiments/papai/docs/plans/done/2025-03-20-drizzle-orm-migration.md`
