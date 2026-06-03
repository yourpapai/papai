<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Dashboard Session Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `DEBUG_TOKEN` with chat-issued, per-admin session cookies for the debug/admin dashboard. Login is initiated by DMing `/dashboard` to the bot, which returns a single-use magic link. Successful claim mints an `HttpOnly; Secure; SameSite=Strict` cookie tied to a row in `dashboard_sessions`.

**Architecture:** A new `src/dashboard-auth/` module owns the claim → session lifecycle and hashes both nonces and cookie values at rest. The debug HTTP server's auth gate becomes "valid session cookie or 401" with no env-token fallback; three new `/auth/*` routes handle claim, logout, and whoami. A new `/dashboard` admin chat command issues claim URLs. A periodic sweeper deletes expired/revoked rows.

**Tech Stack:** Bun + SQLite (`bun:sqlite`), Drizzle-adjacent raw SQL migrations matching the existing `src/db/migrations/0XX_*.ts` style, `node:crypto` for token bytes + hashing + timingSafeEqual, pino logger, existing `ChatProvider.registerCommand` pattern.

**Locked decisions** (from proposal review):

- "Admin" means any user for whom `isAdmin(userId, platformInstanceId)` returns true.
- Session TTL: 8h, no sliding refresh in v1.
- Claim TTL: 5m.
- Claim link is GET with `Referrer-Policy: no-referrer` on the response.
- `DEBUG_TOKEN` is removed entirely — no fallback bearer path.

---

## File Structure

**Created:**

- `src/db/migrations/046_dashboard_sessions.ts` — schema migration
- `src/dashboard-auth/cookie.ts` — cookie parsing + `Set-Cookie` formatting
- `src/dashboard-auth/store.ts` — DB CRUD over `dashboard_claims` and `dashboard_sessions`
- `src/dashboard-auth/index.ts` — public API (`issueClaim`, `consumeClaim`, `mintSession`, `authenticate`, `revokeSession`, `sweepExpired`, `getSessionTtlSeconds`, `getClaimTtlSeconds`)
- `src/dashboard-auth/sweeper.ts` — `setInterval`-based cleanup
- `src/commands/dashboard.ts` — `/dashboard` DM command
- `docs/deployment/dashboard-access.md` — Step-1 deployment guidance
- Test mirrors for each above

**Modified:**

- `src/db/index.ts` — register migration046 in the migration list
- `src/debug/server.ts` — replace `isAuthorizedRequest`, add `/auth/*` routes, drop `DEBUG_TOKEN`
- `src/debug/instance-routes.ts` — drop `authorizeWrite`, reuse shared `authenticate`
- `src/debug/billing-routes.ts` — drop `DEBUG_TOKEN` precondition in `handleAdminLlmPost`
- `src/debug/plugin-config-routes.ts` — drop `DEBUG_TOKEN` precondition in `handleAdminPluginConfigPost`
- `src/commands/index.ts` — export `registerDashboardCommand`
- `src/bot.ts` — wire `registerDashboardCommand` in `registerCommands`
- `src/index.ts` — drop `DEBUG_TOKEN` startup log, log WARN if `DEBUG_TOKEN` env still set, start sweeper
- `client/admin/main.ts` — `whoami` bootstrap + login screen + logout button
- `client/debug/main.ts` — same
- `CLAUDE.md` — remove `DEBUG_TOKEN` from env-vars section, add `/dashboard` description

---

## Task 1: Migration 046 (dashboard_claims + dashboard_sessions tables)

**Files:**

- Create: `src/db/migrations/046_dashboard_sessions.ts`
- Test: `tests/db/migrations/046_dashboard_sessions.test.ts`
- Modify: `src/db/index.ts` (add to the migration list)

- [ ] **Step 1: Write the failing migration test**

```ts
// tests/db/migrations/046_dashboard_sessions.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration046DashboardSessions } from '../../../src/db/migrations/046_dashboard_sessions.js'
import { mockLogger } from '../../utils/test-helpers.js'

interface ColumnRow {
  name: string
  type: string
  notnull: number
  pk: number
}

describe('migration046DashboardSessions', () => {
  let db: Database
  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
    db.run('PRAGMA foreign_keys=ON')
  })
  afterEach(() => {
    db.close()
  })

  test('creates dashboard_claims with expected columns', () => {
    migration046DashboardSessions.up(db)
    const cols = db.query<ColumnRow, []>(`PRAGMA table_info('dashboard_claims')`).all()
    const names = cols.map((c) => c.name).sort()
    expect(names).toEqual([
      'admin_user_id',
      'consumed_at',
      'created_at',
      'expires_at',
      'nonce_hash',
      'platform_instance_id',
    ])
    expect(cols.find((c) => c.name === 'nonce_hash')?.pk).toBe(1)
  })

  test('creates dashboard_sessions with expected columns', () => {
    migration046DashboardSessions.up(db)
    const cols = db.query<ColumnRow, []>(`PRAGMA table_info('dashboard_sessions')`).all()
    const names = cols.map((c) => c.name).sort()
    expect(names).toEqual([
      'admin_user_id',
      'expires_at',
      'id',
      'issued_at',
      'last_seen_at',
      'last_seen_ip',
      'revoked_at',
      'user_agent',
    ])
    expect(cols.find((c) => c.name === 'id')?.pk).toBe(1)
  })

  test('creates dashboard_sessions admin lookup index', () => {
    migration046DashboardSessions.up(db)
    const idx = db
      .query<
        { name: string },
        []
      >(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='dashboard_sessions'`)
      .all()
    expect(idx.map((r) => r.name)).toContain('idx_dashboard_sessions_admin')
  })

  test('is idempotent', () => {
    migration046DashboardSessions.up(db)
    expect(() => migration046DashboardSessions.up(db)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/db/migrations/046_dashboard_sessions.test.ts`
Expected: FAIL — `Cannot find module ... 046_dashboard_sessions.js`

- [ ] **Step 3: Write the migration**

```ts
// src/db/migrations/046_dashboard_sessions.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

const createClaimsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS dashboard_claims (
      nonce_hash TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      platform_instance_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER
    )
  `)
}

const createSessionsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS dashboard_sessions (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      last_seen_at INTEGER,
      last_seen_ip TEXT,
      user_agent TEXT
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_admin ON dashboard_sessions (admin_user_id)`)
}

export const migration046DashboardSessions: Migration = {
  id: '046_dashboard_sessions',
  up(db) {
    createClaimsTable(db)
    createSessionsTable(db)
  },
}
```

- [ ] **Step 4: Register migration in `src/db/index.ts`**

Add the import alongside other migration imports and append `migration046DashboardSessions` to the migration list (locate the existing array — same place `migration045ProviderBaseUrl` is registered).

```ts
import { migration046DashboardSessions } from './migrations/046_dashboard_sessions.js'
// ... in the migrations array, after migration045ProviderBaseUrl:
migration046DashboardSessions,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/db/migrations/046_dashboard_sessions.test.ts`
Expected: PASS (4/4)

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/046_dashboard_sessions.ts src/db/index.ts tests/db/migrations/046_dashboard_sessions.test.ts
git commit -m "feat(dashboard-auth): add dashboard_claims and dashboard_sessions tables"
```

---

## Task 2: Cookie parser + Set-Cookie formatter

**Files:**

- Create: `src/dashboard-auth/cookie.ts`
- Test: `tests/dashboard-auth/cookie.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/dashboard-auth/cookie.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import { describe, expect, test } from 'bun:test'

import {
  buildSetCookie,
  buildClearCookie,
  readSessionCookie,
  SESSION_COOKIE_NAME,
} from '../../src/dashboard-auth/cookie.js'

const reqWith = (headers: Record<string, string>): Request => new Request('http://localhost/test', { headers })

describe('readSessionCookie', () => {
  test('returns null when no Cookie header', () => {
    expect(readSessionCookie(reqWith({}))).toBeNull()
  })

  test('returns the dashboard_session value', () => {
    expect(readSessionCookie(reqWith({ Cookie: `${SESSION_COOKIE_NAME}=abc123` }))).toBe('abc123')
  })

  test('skips other cookies', () => {
    expect(readSessionCookie(reqWith({ Cookie: `theme=dark; ${SESSION_COOKIE_NAME}=abc123; lang=en` }))).toBe('abc123')
  })

  test('trims surrounding whitespace', () => {
    expect(readSessionCookie(reqWith({ Cookie: `  ${SESSION_COOKIE_NAME} = xyz  ` }))).toBe('xyz')
  })

  test('returns null on malformed percent-encoding instead of throwing', () => {
    expect(readSessionCookie(reqWith({ Cookie: `${SESSION_COOKIE_NAME}=%E0%A4%A` }))).toBeNull()
  })
})

describe('buildSetCookie', () => {
  test('emits HttpOnly SameSite=Strict Path=/ with max-age', () => {
    const value = buildSetCookie({ value: 'token', maxAgeSeconds: 60, secure: true })
    expect(value).toContain(`${SESSION_COOKIE_NAME}=token`)
    expect(value).toContain('HttpOnly')
    expect(value).toContain('SameSite=Strict')
    expect(value).toContain('Path=/')
    expect(value).toContain('Max-Age=60')
    expect(value).toContain('Secure')
  })

  test('omits Secure when secure=false (localhost http dev)', () => {
    expect(buildSetCookie({ value: 'token', maxAgeSeconds: 60, secure: false })).not.toContain('Secure')
  })
})

describe('buildClearCookie', () => {
  test('emits Max-Age=0 and the same attributes', () => {
    const value = buildClearCookie({ secure: true })
    expect(value).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(value).toContain('Max-Age=0')
    expect(value).toContain('HttpOnly')
    expect(value).toContain('SameSite=Strict')
    expect(value).toContain('Path=/')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/dashboard-auth/cookie.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```ts
// src/dashboard-auth/cookie.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

export const SESSION_COOKIE_NAME = 'dashboard_session'

export const readSessionCookie = (req: Readonly<Request>): string | null => {
  const raw = req.headers.get('Cookie')
  if (raw === null) return null
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    if (name !== SESSION_COOKIE_NAME) continue
    const rawValue = part.slice(eq + 1).trim()
    try {
      return decodeURIComponent(rawValue)
    } catch {
      return null
    }
  }
  return null
}

interface BuildOptions {
  value: string
  maxAgeSeconds: number
  secure: boolean
}

export const buildSetCookie = (opts: BuildOptions): string => {
  const attrs = [
    `${SESSION_COOKIE_NAME}=${opts.value}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${opts.maxAgeSeconds}`,
  ]
  if (opts.secure) attrs.push('Secure')
  return attrs.join('; ')
}

export const buildClearCookie = (opts: { secure: boolean }): string =>
  buildSetCookie({ value: '', maxAgeSeconds: 0, secure: opts.secure })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/dashboard-auth/cookie.test.ts`
Expected: PASS (8/8)

- [ ] **Step 5: Commit**

```bash
git add src/dashboard-auth/cookie.ts tests/dashboard-auth/cookie.test.ts
git commit -m "feat(dashboard-auth): add session cookie parser and formatter"
```

---

## Task 3: Store layer (claims + sessions, hashed at rest)

**Files:**

- Create: `src/dashboard-auth/store.ts`
- Test: `tests/dashboard-auth/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/dashboard-auth/store.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration046DashboardSessions } from '../../src/db/migrations/046_dashboard_sessions.js'
import {
  consumeClaimByHash,
  deleteExpired,
  insertClaim,
  insertSession,
  loadSessionByHash,
  revokeSessionByHash,
  setStoreDb,
  touchSession,
} from '../../src/dashboard-auth/store.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('dashboard-auth/store', () => {
  let db: Database
  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
    migration046DashboardSessions.up(db)
    setStoreDb(db)
  })
  afterEach(() => {
    db.close()
  })

  test('insertClaim then consumeClaimByHash returns admin + marks consumed', () => {
    insertClaim({ nonceHash: 'hash-a', adminUserId: 'u1', platformInstanceId: 'p1', createdAt: 1000, expiresAt: 2000 })
    const result = consumeClaimByHash('hash-a', 1500)
    expect(result).toEqual({ adminUserId: 'u1' })
    expect(consumeClaimByHash('hash-a', 1500)).toBeNull() // single-use
  })

  test('consumeClaimByHash returns null for expired claim', () => {
    insertClaim({ nonceHash: 'hash-b', adminUserId: 'u1', platformInstanceId: 'p1', createdAt: 1000, expiresAt: 1100 })
    expect(consumeClaimByHash('hash-b', 1200)).toBeNull()
  })

  test('consumeClaimByHash returns null for unknown nonce', () => {
    expect(consumeClaimByHash('nope', 1000)).toBeNull()
  })

  test('insertSession + loadSessionByHash round-trips', () => {
    insertSession({ idHash: 'sid', adminUserId: 'u1', issuedAt: 100, expiresAt: 200 })
    const row = loadSessionByHash('sid', 150)
    expect(row?.adminUserId).toBe('u1')
  })

  test('loadSessionByHash returns null when expired', () => {
    insertSession({ idHash: 'sid2', adminUserId: 'u1', issuedAt: 100, expiresAt: 200 })
    expect(loadSessionByHash('sid2', 250)).toBeNull()
  })

  test('loadSessionByHash returns null when revoked', () => {
    insertSession({ idHash: 'sid3', adminUserId: 'u1', issuedAt: 100, expiresAt: 200 })
    revokeSessionByHash('sid3', 150)
    expect(loadSessionByHash('sid3', 175)).toBeNull()
  })

  test('touchSession updates last_seen_at + last_seen_ip', () => {
    insertSession({ idHash: 'sid4', adminUserId: 'u1', issuedAt: 100, expiresAt: 200 })
    touchSession('sid4', 150, '127.0.0.1', 'agent/1')
    const row = db
      .query<
        { last_seen_at: number; last_seen_ip: string; user_agent: string },
        []
      >(`SELECT last_seen_at, last_seen_ip, user_agent FROM dashboard_sessions WHERE id='sid4'`)
      .get()
    expect(row?.last_seen_at).toBe(150)
    expect(row?.last_seen_ip).toBe('127.0.0.1')
    expect(row?.user_agent).toBe('agent/1')
  })

  test('deleteExpired removes expired claims and sessions', () => {
    insertClaim({ nonceHash: 'old', adminUserId: 'u1', platformInstanceId: 'p1', createdAt: 1, expiresAt: 2 })
    insertClaim({ nonceHash: 'new', adminUserId: 'u1', platformInstanceId: 'p1', createdAt: 1, expiresAt: 10_000 })
    insertSession({ idHash: 'sold', adminUserId: 'u1', issuedAt: 1, expiresAt: 2 })
    insertSession({ idHash: 'snew', adminUserId: 'u1', issuedAt: 1, expiresAt: 10_000 })
    deleteExpired(100)
    expect(db.query(`SELECT COUNT(*) AS n FROM dashboard_claims`).get()).toEqual({ n: 1 } as never)
    expect(db.query(`SELECT COUNT(*) AS n FROM dashboard_sessions`).get()).toEqual({ n: 1 } as never)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/dashboard-auth/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

```ts
// src/dashboard-auth/store.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import type { Database } from 'bun:sqlite'

import { getDb } from '../db/index.js'

let injectedDb: Database | null = null
export const setStoreDb = (db: Database | null): void => {
  injectedDb = db
}
const db = (): Database => injectedDb ?? getDb()

export interface ClaimInsert {
  nonceHash: string
  adminUserId: string
  platformInstanceId: string
  createdAt: number
  expiresAt: number
}
export interface SessionInsert {
  idHash: string
  adminUserId: string
  issuedAt: number
  expiresAt: number
}
export interface SessionRow {
  adminUserId: string
  expiresAt: number
}

export const insertClaim = (claim: ClaimInsert): void => {
  db()
    .query(
      `INSERT INTO dashboard_claims (nonce_hash, admin_user_id, platform_instance_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(claim.nonceHash, claim.adminUserId, claim.platformInstanceId, claim.createdAt, claim.expiresAt)
}

export const consumeClaimByHash = (nonceHash: string, now: number): { adminUserId: string } | null => {
  const row = db()
    .query<
      { admin_user_id: string; expires_at: number; consumed_at: number | null },
      [string]
    >(`SELECT admin_user_id, expires_at, consumed_at FROM dashboard_claims WHERE nonce_hash = ?`)
    .get(nonceHash)
  if (row === null) return null
  if (row.consumed_at !== null) return null
  if (row.expires_at <= now) return null
  const result = db()
    .query<
      { rowsAffected: number },
      [number, string]
    >(`UPDATE dashboard_claims SET consumed_at = ? WHERE nonce_hash = ? AND consumed_at IS NULL`)
    .run(now, nonceHash)
  if (result.changes !== 1) return null
  return { adminUserId: row.admin_user_id }
}

export const insertSession = (session: SessionInsert): void => {
  db()
    .query(`INSERT INTO dashboard_sessions (id, admin_user_id, issued_at, expires_at) VALUES (?, ?, ?, ?)`)
    .run(session.idHash, session.adminUserId, session.issuedAt, session.expiresAt)
}

export const loadSessionByHash = (idHash: string, now: number): SessionRow | null => {
  const row = db()
    .query<
      { admin_user_id: string; expires_at: number; revoked_at: number | null },
      [string]
    >(`SELECT admin_user_id, expires_at, revoked_at FROM dashboard_sessions WHERE id = ?`)
    .get(idHash)
  if (row === null) return null
  if (row.revoked_at !== null) return null
  if (row.expires_at <= now) return null
  return { adminUserId: row.admin_user_id, expiresAt: row.expires_at }
}

export const revokeSessionByHash = (idHash: string, now: number): void => {
  db().query(`UPDATE dashboard_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`).run(now, idHash)
}

export const touchSession = (idHash: string, now: number, ip: string | null, userAgent: string | null): void => {
  db()
    .query(`UPDATE dashboard_sessions SET last_seen_at = ?, last_seen_ip = ?, user_agent = ? WHERE id = ?`)
    .run(now, ip, userAgent, idHash)
}

export const deleteExpired = (now: number): void => {
  db().query(`DELETE FROM dashboard_claims WHERE expires_at <= ?`).run(now)
  db().query(`DELETE FROM dashboard_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL`).run(now)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/dashboard-auth/store.test.ts`
Expected: PASS (8/8)

- [ ] **Step 5: Commit**

```bash
git add src/dashboard-auth/store.ts tests/dashboard-auth/store.test.ts
git commit -m "feat(dashboard-auth): add claim and session DB store"
```

---

## Task 4: Public API — issueClaim, consumeClaim, mintSession, authenticate, revokeSession

**Files:**

- Create: `src/dashboard-auth/index.ts`
- Test: `tests/dashboard-auth/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/dashboard-auth/index.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration046DashboardSessions } from '../../src/db/migrations/046_dashboard_sessions.js'
import {
  authenticate,
  consumeClaim,
  getClaimTtlSeconds,
  getSessionTtlSeconds,
  issueClaim,
  mintSession,
  revokeSession,
  sweepExpired,
} from '../../src/dashboard-auth/index.js'
import { setStoreDb } from '../../src/dashboard-auth/store.js'
import { SESSION_COOKIE_NAME } from '../../src/dashboard-auth/cookie.js'
import { mockLogger } from '../utils/test-helpers.js'

const makeReq = (cookie?: string): Request =>
  new Request('http://localhost/', cookie === undefined ? {} : { headers: { Cookie: cookie } })

describe('dashboard-auth', () => {
  let db: Database
  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
    migration046DashboardSessions.up(db)
    setStoreDb(db)
  })
  afterEach(() => {
    db.close()
    setStoreDb(null)
  })

  test('issueClaim returns a high-entropy nonce + records hashed copy', () => {
    const { nonce, expiresAt } = issueClaim('u1', 'p1')
    expect(nonce).toMatch(/^[0-9a-f]{32}$/) // 128 bits hex
    expect(expiresAt).toBeGreaterThan(Date.now())
    expect(db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM dashboard_claims`).get()?.n).toBe(1)
  })

  test('consumeClaim mints a session for a valid nonce', () => {
    const { nonce } = issueClaim('u1', 'p1')
    const result = consumeClaim(nonce)
    expect(result?.adminUserId).toBe('u1')
  })

  test('consumeClaim returns null for unknown nonce', () => {
    expect(consumeClaim('deadbeef')).toBeNull()
  })

  test('consumeClaim returns null on replay', () => {
    const { nonce } = issueClaim('u1', 'p1')
    expect(consumeClaim(nonce)?.adminUserId).toBe('u1')
    expect(consumeClaim(nonce)).toBeNull()
  })

  test('mintSession returns cookie value + Set-Cookie header', () => {
    const { cookieValue, setCookie } = mintSession('u1', { secure: true })
    expect(cookieValue).toMatch(/^[0-9a-f]{64}$/) // 256 bits hex
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=${cookieValue}`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).toContain('Secure')
  })

  test('authenticate returns adminUserId for a valid cookie', () => {
    const { cookieValue } = mintSession('u1', { secure: false })
    const res = authenticate(makeReq(`${SESSION_COOKIE_NAME}=${cookieValue}`))
    expect(res?.adminUserId).toBe('u1')
  })

  test('authenticate returns null when no cookie', () => {
    expect(authenticate(makeReq())).toBeNull()
  })

  test('authenticate returns null when cookie value unknown', () => {
    expect(authenticate(makeReq(`${SESSION_COOKIE_NAME}=ffff`))).toBeNull()
  })

  test('revokeSession invalidates the session', () => {
    const { cookieValue } = mintSession('u1', { secure: false })
    revokeSession(cookieValue)
    expect(authenticate(makeReq(`${SESSION_COOKIE_NAME}=${cookieValue}`))).toBeNull()
  })

  test('sweepExpired removes expired rows', () => {
    issueClaim('u1', 'p1')
    mintSession('u1', { secure: false })
    sweepExpired(Number.MAX_SAFE_INTEGER)
    expect(db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM dashboard_claims`).get()?.n).toBe(0)
    expect(db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM dashboard_sessions`).get()?.n).toBe(0)
  })

  test('TTLs come from env with sensible defaults', () => {
    expect(getSessionTtlSeconds()).toBe(28800)
    expect(getClaimTtlSeconds()).toBe(300)
    process.env['DASHBOARD_SESSION_TTL_SECONDS'] = '60'
    process.env['DASHBOARD_CLAIM_TTL_SECONDS'] = '30'
    expect(getSessionTtlSeconds()).toBe(60)
    expect(getClaimTtlSeconds()).toBe(30)
    delete process.env['DASHBOARD_SESSION_TTL_SECONDS']
    delete process.env['DASHBOARD_CLAIM_TTL_SECONDS']
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/dashboard-auth/index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```ts
// src/dashboard-auth/index.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import { createHash, randomBytes } from 'node:crypto'

import { logger } from '../logger.js'
import { readSessionCookie, buildSetCookie, buildClearCookie } from './cookie.js'
import {
  consumeClaimByHash,
  deleteExpired,
  insertClaim,
  insertSession,
  loadSessionByHash,
  revokeSessionByHash,
  touchSession,
} from './store.js'

const log = logger.child({ scope: 'dashboard-auth' })

const NONCE_BYTES = 16 // 128 bits
const SESSION_BYTES = 32 // 256 bits
const DEFAULT_SESSION_TTL = 28_800
const DEFAULT_CLAIM_TTL = 300

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

const positiveIntFromEnv = (name: string, fallback: number): number => {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed) || parsed <= 0) return fallback
  return parsed
}

export const getSessionTtlSeconds = (): number =>
  positiveIntFromEnv('DASHBOARD_SESSION_TTL_SECONDS', DEFAULT_SESSION_TTL)
export const getClaimTtlSeconds = (): number => positiveIntFromEnv('DASHBOARD_CLAIM_TTL_SECONDS', DEFAULT_CLAIM_TTL)

export interface IssuedClaim {
  nonce: string
  expiresAt: number
}

export const issueClaim = (adminUserId: string, platformInstanceId: string): IssuedClaim => {
  const nonce = randomBytes(NONCE_BYTES).toString('hex')
  const now = Date.now()
  const expiresAt = now + getClaimTtlSeconds() * 1000
  insertClaim({ nonceHash: sha256(nonce), adminUserId, platformInstanceId, createdAt: now, expiresAt })
  log.info({ adminUserId, platformInstanceId, expiresAt }, 'issued dashboard claim')
  return { nonce, expiresAt }
}

export const consumeClaim = (nonce: string): { adminUserId: string } | null => {
  if (nonce === '') return null
  return consumeClaimByHash(sha256(nonce), Date.now())
}

export interface MintedSession {
  cookieValue: string
  setCookie: string
  expiresAt: number
}

export const mintSession = (adminUserId: string, opts: { secure: boolean }): MintedSession => {
  const cookieValue = randomBytes(SESSION_BYTES).toString('hex')
  const issuedAt = Date.now()
  const ttlSeconds = getSessionTtlSeconds()
  const expiresAt = issuedAt + ttlSeconds * 1000
  insertSession({ idHash: sha256(cookieValue), adminUserId, issuedAt, expiresAt })
  const setCookie = buildSetCookie({ value: cookieValue, maxAgeSeconds: ttlSeconds, secure: opts.secure })
  log.info({ adminUserId, expiresAt }, 'minted dashboard session')
  return { cookieValue, setCookie, expiresAt }
}

export interface AuthenticatedRequest {
  adminUserId: string
  expiresAt: number
  sessionIdHash: string
}

export const authenticate = (req: Readonly<Request>): AuthenticatedRequest | null => {
  const cookie = readSessionCookie(req)
  if (cookie === null) return null
  const idHash = sha256(cookie)
  const row = loadSessionByHash(idHash, Date.now())
  if (row === null) return null
  return { adminUserId: row.adminUserId, expiresAt: row.expiresAt, sessionIdHash: idHash }
}

export const revokeSession = (cookieValue: string): void => {
  revokeSessionByHash(sha256(cookieValue), Date.now())
}

export const recordActivity = (idHash: string, req: Readonly<Request>): void => {
  const ip = req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? null
  const ua = req.headers.get('User-Agent')
  touchSession(idHash, Date.now(), ip, ua)
}

export const sweepExpired = (now: number = Date.now()): void => {
  deleteExpired(now)
}

export { buildClearCookie }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/dashboard-auth/index.test.ts`
Expected: PASS (11/11)

- [ ] **Step 5: Commit**

```bash
git add src/dashboard-auth/index.ts tests/dashboard-auth/index.test.ts
git commit -m "feat(dashboard-auth): public claim and session API"
```

---

## Task 5: Sweeper

**Files:**

- Create: `src/dashboard-auth/sweeper.ts`
- Test: `tests/dashboard-auth/sweeper.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/dashboard-auth/sweeper.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

describe('startSweeper', () => {
  let originalSetInterval: typeof setInterval
  let cleared: ReturnType<typeof setInterval> | null = null

  beforeEach(() => {
    originalSetInterval = global.setInterval
  })
  afterEach(() => {
    global.setInterval = originalSetInterval
    cleared = null
  })

  test('schedules sweep at the configured interval and returns stop()', async () => {
    const sweepMock = mock(() => {})
    const fakeHandle = { unref() {} } as unknown as ReturnType<typeof setInterval>
    global.setInterval = ((fn: () => void, ms: number) => {
      expect(ms).toBe(60_000)
      fn() // run once synchronously to assert it calls sweep
      return fakeHandle
    }) as unknown as typeof setInterval

    const { startSweeper } = await import('../../src/dashboard-auth/sweeper.js')
    const stop = startSweeper({ intervalMs: 60_000, sweep: sweepMock })
    expect(sweepMock).toHaveBeenCalled()
    stop()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/dashboard-auth/sweeper.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/dashboard-auth/sweeper.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import { logger } from '../logger.js'
import { sweepExpired } from './index.js'

const log = logger.child({ scope: 'dashboard-auth:sweeper' })

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000 // 1h

export interface SweeperOptions {
  intervalMs?: number
  sweep?: () => void
}

export const startSweeper = (opts: SweeperOptions = {}): (() => void) => {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  const sweep = opts.sweep ?? ((): void => sweepExpired())
  log.info({ intervalMs }, 'dashboard-auth sweeper starting')
  const handle = setInterval(() => {
    try {
      sweep()
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'dashboard-auth sweep failed')
    }
  }, intervalMs)
  if (typeof (handle as { unref?: () => void }).unref === 'function') (handle as { unref: () => void }).unref()
  return (): void => {
    clearInterval(handle)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/dashboard-auth/sweeper.test.ts`
Expected: PASS (1/1)

- [ ] **Step 5: Commit**

```bash
git add src/dashboard-auth/sweeper.ts tests/dashboard-auth/sweeper.test.ts
git commit -m "feat(dashboard-auth): periodic sweeper for expired claims and sessions"
```

---

## Task 6: Replace `isAuthorizedRequest` in `src/debug/server.ts` with session gate

**Files:**

- Modify: `src/debug/server.ts` (lines 45–60 and 268, 274–277)
- Test: `tests/debug/server-auth.test.ts` (new file to avoid colliding with existing `server.test.ts`)

- [ ] **Step 1: Write the failing test**

```ts
// tests/debug/server-auth.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration046DashboardSessions } from '../../src/db/migrations/046_dashboard_sessions.js'
import { mintSession } from '../../src/dashboard-auth/index.js'
import { setStoreDb } from '../../src/dashboard-auth/store.js'
import { SESSION_COOKIE_NAME } from '../../src/dashboard-auth/cookie.js'
import { __routeRequestForTest } from '../../src/debug/server.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('debug server auth (session-only)', () => {
  let db: Database
  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
    migration046DashboardSessions.up(db)
    setStoreDb(db)
  })
  afterEach(() => {
    db.close()
    setStoreDb(null)
  })

  test('returns 401 with no cookie', async () => {
    const res = await __routeRequestForTest(new Request('http://localhost/events'))
    expect(res.status).toBe(401)
  })

  test('returns 401 with an unknown cookie value', async () => {
    const res = await __routeRequestForTest(
      new Request('http://localhost/events', { headers: { Cookie: `${SESSION_COOKIE_NAME}=ffff` } }),
    )
    expect(res.status).toBe(401)
  })

  test('accepts a minted session cookie', async () => {
    const { cookieValue } = mintSession('admin-1', { secure: false })
    const res = await __routeRequestForTest(
      new Request('http://localhost/logs/stats', { headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` } }),
    )
    expect(res.status).toBe(200)
  })

  test('rejects bearer header (DEBUG_TOKEN no longer accepted)', async () => {
    process.env['DEBUG_TOKEN'] = 'legacy'
    const res = await __routeRequestForTest(
      new Request('http://localhost/logs/stats', { headers: { Authorization: 'Bearer legacy' } }),
    )
    expect(res.status).toBe(401)
    delete process.env['DEBUG_TOKEN']
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/server-auth.test.ts`
Expected: FAIL — `__routeRequestForTest` not exported / cookie path not implemented.

- [ ] **Step 3: Replace the auth gate in `src/debug/server.ts`**

Find the existing block at `src/debug/server.ts:45-60`:

```ts
function getDebugToken(): string | null { ... }
function isAuthorizedRequest(req: Request): boolean { ... }
```

Replace it with:

```ts
import { authenticate, recordActivity } from '../dashboard-auth/index.js'

function isAuthorizedRequest(req: Readonly<Request>): boolean {
  const session = authenticate(req)
  if (session === null) return false
  recordActivity(session.sessionIdHash, req)
  return true
}
```

Remove `getDebugToken` entirely. Then update the startup log at `src/debug/server.ts:268-277`:

```ts
export function startDebugServer(adminUserId: string, ...args: [] | [string]): void {
  init(adminUserId)
  const logLevel = args.length === 0 ? getLogLevel() : args[0]
  logMultistream.add({ stream: logBufferStream, level: logLevel })

  const port = getPort()
  const hostname = getHostname()

  server = Bun.serve({ port, hostname, idleTimeout: 0, fetch: routeRequest })

  log.info({ port, hostname }, 'Debug server started (session auth)')
}
```

Export the route handler for tests by adding at the bottom of the file:

```ts
export const __routeRequestForTest = (req: Request): Promise<Response> => routeRequest(req)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/server-auth.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add src/debug/server.ts tests/debug/server-auth.test.ts
git commit -m "feat(debug-server): replace DEBUG_TOKEN gate with dashboard session auth"
```

---

## Task 7: `/auth/claim`, `/auth/logout`, `/auth/whoami` routes

**Files:**

- Modify: `src/debug/server.ts` (add routes before the auth gate)
- Test: `tests/debug/server-auth-routes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/debug/server-auth-routes.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration046DashboardSessions } from '../../src/db/migrations/046_dashboard_sessions.js'
import { issueClaim, mintSession } from '../../src/dashboard-auth/index.js'
import { setStoreDb } from '../../src/dashboard-auth/store.js'
import { SESSION_COOKIE_NAME } from '../../src/dashboard-auth/cookie.js'
import { __routeRequestForTest } from '../../src/debug/server.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('/auth/* routes', () => {
  let db: Database
  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
    migration046DashboardSessions.up(db)
    setStoreDb(db)
  })
  afterEach(() => {
    db.close()
    setStoreDb(null)
  })

  test('GET /auth/claim consumes a nonce, sets cookie, redirects to /admin', async () => {
    const { nonce } = issueClaim('u1', 'p1')
    const res = await __routeRequestForTest(new Request(`http://localhost/auth/claim?n=${nonce}`))
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/admin')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    const setCookie = res.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
  })

  test('GET /auth/claim rejects unknown nonce with 401', async () => {
    const res = await __routeRequestForTest(new Request('http://localhost/auth/claim?n=deadbeef'))
    expect(res.status).toBe(401)
  })

  test('GET /auth/claim rejects a replayed nonce', async () => {
    const { nonce } = issueClaim('u1', 'p1')
    await __routeRequestForTest(new Request(`http://localhost/auth/claim?n=${nonce}`))
    const res = await __routeRequestForTest(new Request(`http://localhost/auth/claim?n=${nonce}`))
    expect(res.status).toBe(401)
  })

  test('POST /auth/logout revokes and clears cookie', async () => {
    const { cookieValue } = mintSession('u1', { secure: false })
    const res = await __routeRequestForTest(
      new Request('http://localhost/auth/logout', {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie') ?? '').toContain('Max-Age=0')
    const after = await __routeRequestForTest(
      new Request('http://localhost/logs/stats', { headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` } }),
    )
    expect(after.status).toBe(401)
  })

  test('GET /auth/whoami returns 401 without cookie', async () => {
    const res = await __routeRequestForTest(new Request('http://localhost/auth/whoami'))
    expect(res.status).toBe(401)
  })

  test('GET /auth/whoami returns adminUserId for a valid cookie', async () => {
    const { cookieValue } = mintSession('u1', { secure: false })
    const res = await __routeRequestForTest(
      new Request('http://localhost/auth/whoami', { headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` } }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { adminUserId: string }
    expect(body.adminUserId).toBe('u1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/server-auth-routes.test.ts`
Expected: FAIL — routes not yet handled.

- [ ] **Step 3: Add the route handlers in `src/debug/server.ts`**

Add this block above `routeRequest` and call it from `routeRequest` **before** the auth gate:

```ts
import { authenticate, buildClearCookie, consumeClaim, mintSession, revokeSession } from '../dashboard-auth/index.js'
import { readSessionCookie, SESSION_COOKIE_NAME } from '../dashboard-auth/cookie.js'

const isSecureRequest = (req: Request): boolean => {
  const proto = req.headers.get('X-Forwarded-Proto')
  if (proto !== null) return proto === 'https'
  return new URL(req.url).protocol === 'https:'
}

const handleAuthClaim = (req: Request, url: URL): Response => {
  const nonce = url.searchParams.get('n')
  if (nonce === null || nonce === '') return new Response('Unauthorized', { status: 401 })
  const result = consumeClaim(nonce)
  if (result === null) return new Response('Unauthorized', { status: 401 })
  const { setCookie } = mintSession(result.adminUserId, { secure: isSecureRequest(req) })
  return new Response(null, {
    status: 302,
    headers: { Location: '/admin', 'Set-Cookie': setCookie, 'Referrer-Policy': 'no-referrer' },
  })
}

const handleAuthLogout = (req: Request): Response => {
  const cookie = readSessionCookie(req)
  if (cookie !== null) revokeSession(cookie)
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': buildClearCookie({ secure: isSecureRequest(req) }) },
  })
}

const handleAuthWhoami = (req: Request): Response => {
  const session = authenticate(req)
  if (session === null) return new Response('Unauthorized', { status: 401 })
  return new Response(JSON.stringify({ adminUserId: session.adminUserId, expiresAt: session.expiresAt }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
```

Then in `routeRequest`, inject **before** the existing `if (!isAuthorizedRequest(req))` gate:

```ts
async function routeRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)

  if (url.pathname === '/auth/claim' && req.method === 'GET') return handleAuthClaim(req, url)
  if (url.pathname === '/auth/logout' && req.method === 'POST') return handleAuthLogout(req)
  if (url.pathname === '/auth/whoami' && req.method === 'GET') return handleAuthWhoami(req)

  if (!isAuthorizedRequest(req)) return new Response('Unauthorized', { status: 401 })
  // ... rest unchanged
}
```

(Move the `const url = new URL(req.url)` declaration to the top of `routeRequest` if it isn't already, since the new routes need it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/server-auth-routes.test.ts`
Expected: PASS (6/6)

- [ ] **Step 5: Commit**

```bash
git add src/debug/server.ts tests/debug/server-auth-routes.test.ts
git commit -m "feat(debug-server): add /auth/claim, /auth/logout, /auth/whoami"
```

---

## Task 8: Collapse write-route DEBUG_TOKEN checks (instance, billing, plugin-config)

**Files:**

- Modify: `src/debug/instance-routes.ts:108-115` and the callsite at line 280
- Modify: `src/debug/billing-routes.ts:46-51`
- Modify: `src/debug/plugin-config-routes.ts:43-47`
- Test: `tests/debug/server-write-auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/debug/server-write-auth.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration046DashboardSessions } from '../../src/db/migrations/046_dashboard_sessions.js'
import { mintSession } from '../../src/dashboard-auth/index.js'
import { setStoreDb } from '../../src/dashboard-auth/store.js'
import { SESSION_COOKIE_NAME } from '../../src/dashboard-auth/cookie.js'
import { __routeRequestForTest } from '../../src/debug/server.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('write routes accept the session cookie (no DEBUG_TOKEN)', () => {
  let db: Database
  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
    migration046DashboardSessions.up(db)
    setStoreDb(db)
    delete process.env['DEBUG_TOKEN']
  })
  afterEach(() => {
    db.close()
    setStoreDb(null)
  })

  test('POST /admin/llm with valid cookie is not blocked by missing DEBUG_TOKEN', async () => {
    const { cookieValue } = mintSession('u1', { secure: false })
    const res = await __routeRequestForTest(
      new Request('http://localhost/admin/llm', {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    // Whatever the body validation says, it must NOT be 401 with a "DEBUG_TOKEN" message.
    expect(res.status).not.toBe(401)
  })

  test('POST /admin/plugin-config with valid cookie is not 401', async () => {
    const { cookieValue } = mintSession('u1', { secure: false })
    const res = await __routeRequestForTest(
      new Request('http://localhost/admin/plugin-config', {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).not.toBe(401)
  })

  test('POST /api/platform-instances rejects without cookie', async () => {
    const res = await __routeRequestForTest(new Request('http://localhost/api/platform-instances', { method: 'POST' }))
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/server-write-auth.test.ts`
Expected: FAIL — the inner `DEBUG_TOKEN` checks still 401.

- [ ] **Step 3: Remove the DEBUG_TOKEN checks**

In `src/debug/billing-routes.ts`, replace `handleAdminLlmPost`'s body:

```ts
export const handleAdminLlmPost = async (req: Request): Promise<Response> => {
  const adminUserId = process.env['ADMIN_USER_ID']
  if (adminUserId === undefined || adminUserId === '') {
    log.error('admin/llm POST refused: ADMIN_USER_ID is not set in env')
    return jsonResponse(503, { error: 'admin user id not configured' })
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { error: 'invalid JSON body' })
  }
  try {
    const result = applyAdminLlmUpdate(body, adminUserId)
    return jsonResponse(200, { ok: true, key: result.key, updatedAt: result.updatedAt })
  } catch (err) {
    // ...existing AdminLlmError handling
  }
}
```

In `src/debug/plugin-config-routes.ts`, drop the `DEBUG_TOKEN` precondition at the top of `handleAdminPluginConfigPost` so it goes straight to the body parse.

In `src/debug/instance-routes.ts`, delete the local `authorizeWrite` (lines 108–115) and replace its callsite at line 280:

```ts
import { authenticate } from '../dashboard-auth/index.js'

// at line 280, replace:
//   if ((req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') && !authorizeWrite(req)) {
// with:
if ((req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') && authenticate(req) === null) {
  return textResponse('Unauthorized', 401)
}
```

- [ ] **Step 4: Update existing tests that send Bearer headers**

In `tests/debug/instance-routes.test.ts`, replace every `Authorization: \`Bearer ${TOKEN}\`` with `Cookie: \`${SESSION_COOKIE_NAME}=\${cookieValue}\``after minting a session in the`beforeEach`. Concrete pattern:

```ts
import { mintSession } from '../../src/dashboard-auth/index.js'
import { setStoreDb } from '../../src/dashboard-auth/store.js'
import { migration046DashboardSessions } from '../../src/db/migrations/046_dashboard_sessions.js'
import { SESSION_COOKIE_NAME } from '../../src/dashboard-auth/cookie.js'

let cookieValue: string
beforeEach(() => {
  migration046DashboardSessions.up(testDb) // apply on the same in-memory db the tests already use
  setStoreDb(testDb)
  cookieValue = mintSession('admin', { secure: false }).cookieValue
})
afterEach(() => {
  setStoreDb(null)
})

const authHeaders = { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` }
```

Delete the `process.env['DEBUG_TOKEN']` assignments in `instance-routes.test.ts` and `server.test.ts`. Delete the test cases that asserted "401 when DEBUG_TOKEN unset" — they're no longer meaningful.

- [ ] **Step 5: Run all debug tests**

Run: `bun test tests/debug/`
Expected: PASS across the directory.

- [ ] **Step 6: Commit**

```bash
git add src/debug/instance-routes.ts src/debug/billing-routes.ts src/debug/plugin-config-routes.ts tests/debug/
git commit -m "refactor(debug-server): drop DEBUG_TOKEN checks; rely on session auth"
```

---

## Task 9: `/dashboard` chat command

**Files:**

- Create: `src/commands/dashboard.ts`
- Modify: `src/commands/index.ts` (add `export { registerDashboardCommand }`)
- Modify: `src/bot.ts:109+` (wire it in `registerCommands`)
- Test: `tests/commands/dashboard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/commands/dashboard.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { migration046DashboardSessions } from '../../src/db/migrations/046_dashboard_sessions.js'
import { setStoreDb } from '../../src/dashboard-auth/store.js'
import { registerDashboardCommand } from '../../src/commands/dashboard.js'
import { mockLogger } from '../utils/test-helpers.js'

type Handler = (msg: unknown, reply: unknown, auth: unknown) => Promise<void>

const stubChat = (): { registerCommand: ReturnType<typeof mock>; handler: Handler | null } => {
  const state = { registerCommand: mock(() => {}), handler: null as Handler | null }
  state.registerCommand = mock((name: string, h: Handler) => {
    if (name === 'dashboard') state.handler = h
  })
  return state
}

const stubReply = () => {
  const calls: string[] = []
  return {
    calls,
    text: mock(async (s: string) => {
      calls.push(s)
    }),
    formatted: mock(async (s: string) => {
      calls.push(s)
    }),
    typing: mock(async () => {}),
    buttons: mock(async () => {}),
  }
}

describe('/dashboard command', () => {
  let db: Database
  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
    migration046DashboardSessions.up(db)
    setStoreDb(db)
    process.env['DEBUG_SERVER'] = 'true'
  })
  afterEach(() => {
    db.close()
    setStoreDb(null)
    delete process.env['DEBUG_SERVER']
  })

  test('rejects when auth.allowed is false', async () => {
    const chat = stubChat()
    registerDashboardCommand(chat as never)
    const reply = stubReply()
    await chat.handler?.({ contextType: 'dm' } as never, reply as never, { allowed: false } as never)
    expect(reply.calls).toHaveLength(0)
  })

  test('rejects in groups', async () => {
    const chat = stubChat()
    registerDashboardCommand(chat as never)
    const reply = stubReply()
    await chat.handler?.(
      { contextType: 'group' } as never,
      reply as never,
      { allowed: true, isBotAdmin: true } as never,
    )
    expect(reply.calls.join('\n')).toContain('DM')
  })

  test('rejects non-admins', async () => {
    const chat = stubChat()
    registerDashboardCommand(chat as never)
    const reply = stubReply()
    await chat.handler?.({ contextType: 'dm' } as never, reply as never, { allowed: true, isBotAdmin: false } as never)
    expect(reply.calls.join('\n')).toMatch(/admin/i)
  })

  test('refuses when DEBUG_SERVER is not enabled', async () => {
    delete process.env['DEBUG_SERVER']
    const chat = stubChat()
    registerDashboardCommand(chat as never)
    const reply = stubReply()
    await chat.handler?.(
      { contextType: 'dm', platformInstanceId: 'p1', from: { id: 'u1' } } as never,
      reply as never,
      { allowed: true, isBotAdmin: true } as never,
    )
    expect(reply.calls.join('\n')).toMatch(/disabled|not enabled/i)
  })

  test('replies with a claim URL for an admin in DM', async () => {
    const chat = stubChat()
    registerDashboardCommand(chat as never)
    const reply = stubReply()
    await chat.handler?.(
      { contextType: 'dm', platformInstanceId: 'p1', from: { id: 'u1' } } as never,
      reply as never,
      { allowed: true, isBotAdmin: true } as never,
    )
    const body = reply.calls.join('\n')
    expect(body).toMatch(/\/auth\/claim\?n=[0-9a-f]{32}/)
    expect(body).toMatch(/5 min/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/commands/dashboard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the command**

```ts
// src/commands/dashboard.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { getClaimTtlSeconds, issueClaim } from '../dashboard-auth/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'commands:dashboard' })

const defaultBaseUrl = (): string => {
  const explicit = process.env['DASHBOARD_BASE_URL']
  if (explicit !== undefined && explicit !== '') return explicit.replace(/\/$/, '')
  const host = process.env['DEBUG_HOSTNAME'] ?? '127.0.0.1'
  const port = process.env['DEBUG_PORT'] ?? '9100'
  return `http://${host}:${port}`
}

const isDebugServerEnabled = (): boolean => process.env['DEBUG_SERVER'] === 'true'

export const registerDashboardCommand = (chat: Readonly<ChatProvider>): void => {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) return

    if (msg.contextType !== 'dm') {
      await reply.text('Open this in a DM with me — `/dashboard` is DM-only.')
      return
    }
    if (auth.isBotAdmin !== true) {
      await reply.text('Only bot admins can claim a dashboard session.')
      return
    }
    if (!isDebugServerEnabled()) {
      await reply.text('The dashboard is disabled on this deployment (DEBUG_SERVER is not enabled).')
      return
    }

    const adminUserId = msg.from?.id
    if (adminUserId === undefined || adminUserId === '') {
      log.error('dashboard command: msg.from.id missing')
      await reply.text('Could not identify the requesting user.')
      return
    }

    const { nonce } = issueClaim(adminUserId, msg.platformInstanceId)
    const url = `${defaultBaseUrl()}/auth/claim?n=${nonce}`
    const ttlMinutes = Math.round(getClaimTtlSeconds() / 60)
    await reply.text(`Open this link to sign in:\n\n${url}\n\nLink expires in ${ttlMinutes} min and can be used once.`)
  }

  chat.registerCommand('dashboard', handler)
}
```

- [ ] **Step 4: Export from the commands index**

In `src/commands/index.ts`, add:

```ts
export { registerDashboardCommand } from './dashboard.js'
```

- [ ] **Step 5: Wire it in `src/bot.ts`**

In `src/bot.ts`, add to the import block (around line 24):

```ts
import { ..., registerDashboardCommand, ... } from './commands/index.js'
```

In `registerCommands` (around line 109), add after `registerPluginCommand(observedChat, adminUserId)`:

```ts
registerDashboardCommand(observedChat)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/commands/dashboard.test.ts`
Expected: PASS (5/5)

- [ ] **Step 7: Commit**

```bash
git add src/commands/dashboard.ts src/commands/index.ts src/bot.ts tests/commands/dashboard.test.ts
git commit -m "feat(commands): add /dashboard claim-link issuer"
```

---

## Task 10: Startup wiring (sweeper start + DEBUG_TOKEN deprecation warning)

**Files:**

- Modify: `src/index.ts` (drop any `DEBUG_TOKEN` references, start sweeper, warn if env still set)
- Test: `tests/index-debug-token-warn.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/index-debug-token-warn.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { warnIfLegacyDebugToken } from '../src/index.js'
import { captureLogger, mockLogger } from './utils/test-helpers.js'

describe('warnIfLegacyDebugToken', () => {
  beforeEach(() => {
    mockLogger()
  })
  afterEach(() => {
    delete process.env['DEBUG_TOKEN']
  })

  test('emits a WARN when DEBUG_TOKEN is set', () => {
    process.env['DEBUG_TOKEN'] = 'x'
    const captured = captureLogger()
    warnIfLegacyDebugToken()
    expect(captured.warnings).toContain(
      'DEBUG_TOKEN is ignored — dashboard auth is now chat-issued. Remove DEBUG_TOKEN from your env and DM /dashboard to sign in.',
    )
  })

  test('is silent when DEBUG_TOKEN is not set', () => {
    delete process.env['DEBUG_TOKEN']
    const captured = captureLogger()
    warnIfLegacyDebugToken()
    expect(captured.warnings).toHaveLength(0)
  })
})
```

(If `captureLogger` isn't already a helper in `tests/utils/test-helpers.ts`, add a minimal one that subscribes to pino's `warn` channel for the duration of the test. The existing `mockLogger()` does something similar — inspect it and reuse.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/index-debug-token-warn.test.ts`
Expected: FAIL — `warnIfLegacyDebugToken` not exported.

- [ ] **Step 3: Add to `src/index.ts`**

Near the other startup helpers in `src/index.ts`, add and export:

```ts
import { startSweeper } from './dashboard-auth/sweeper.js'

export const warnIfLegacyDebugToken = (): void => {
  if (process.env['DEBUG_TOKEN'] !== undefined && process.env['DEBUG_TOKEN'] !== '') {
    logger.warn(
      'DEBUG_TOKEN is ignored — dashboard auth is now chat-issued. Remove DEBUG_TOKEN from your env and DM /dashboard to sign in.',
    )
  }
}
```

Call it inside the existing startup function before `startDebugServer(...)` is invoked, and start the sweeper there too:

```ts
warnIfLegacyDebugToken()
startSweeper()
```

Remove any remaining `process.env['DEBUG_TOKEN']` references in `src/index.ts` (there may be a startup info log line referencing it — delete it).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/index-debug-token-warn.test.ts`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index-debug-token-warn.test.ts
git commit -m "feat(startup): warn on legacy DEBUG_TOKEN; start dashboard-auth sweeper"
```

---

## Task 11: Client login screen + logout (admin UI)

**Files:**

- Modify: `client/admin/main.ts`
- Modify: `client/admin/App.svelte` (or wherever the header renders — locate by reading `client/admin/` entrypoints)
- Test: `tests/client/admin/whoami-bootstrap.test.ts`

- [ ] **Step 1: Read existing entrypoints to ground the next step**

Run: `ls client/admin/ && head -40 client/admin/main.ts`
Note where the root component is mounted; that's where the bootstrap call must go.

- [ ] **Step 2: Write the failing test**

```ts
// tests/client/admin/whoami-bootstrap.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { ensureAuthenticated } from '../../../client/admin/auth.js'

const fakeFetch = (status: number, body: unknown = {}) =>
  mock(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

describe('ensureAuthenticated', () => {
  let originalFetch: typeof fetch
  beforeEach(() => {
    originalFetch = global.fetch
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  test('returns { authenticated: true, adminUserId } on 200', async () => {
    global.fetch = fakeFetch(200, { adminUserId: 'u1', expiresAt: 9999 }) as never
    const result = await ensureAuthenticated()
    expect(result).toEqual({ authenticated: true, adminUserId: 'u1' })
  })

  test('returns { authenticated: false } on 401', async () => {
    global.fetch = fakeFetch(401) as never
    const result = await ensureAuthenticated()
    expect(result.authenticated).toBe(false)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test:client tests/client/admin/whoami-bootstrap.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `client/admin/auth.ts`**

```ts
// client/admin/auth.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

export type AuthState = { authenticated: true; adminUserId: string } | { authenticated: false }

export const ensureAuthenticated = async (): Promise<AuthState> => {
  const res = await fetch('/auth/whoami', { credentials: 'include' })
  if (res.status !== 200) return { authenticated: false }
  const body = (await res.json()) as { adminUserId: string }
  return { authenticated: true, adminUserId: body.adminUserId }
}

export const logout = async (): Promise<void> => {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
  window.location.reload()
}
```

- [ ] **Step 5: Wire into `client/admin/main.ts`**

At the top of the bootstrap, gate the existing app mount on `ensureAuthenticated()`:

```ts
import { ensureAuthenticated } from './auth.js'

const state = await ensureAuthenticated()
if (!state.authenticated) {
  document.body.innerHTML = `
    <main style="font-family: system-ui; max-width: 540px; margin: 4rem auto; padding: 1rem; line-height: 1.5;">
      <h1>Sign in required</h1>
      <p>DM <code>/dashboard</code> to the bot to receive a sign-in link.</p>
    </main>`
} else {
  // ...existing mount code
}
```

Add a "Sign out" button in the admin header (use the existing header component and import `logout` from `./auth.js`). Match the styling of nearby buttons.

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test:client tests/client/admin/whoami-bootstrap.test.ts`
Expected: PASS (2/2)

- [ ] **Step 7: Manual smoke test**

Run: `bun start:debug`
Expected: visiting `/admin` without a cookie shows the sign-in screen. After running `/dashboard` in a DM (against a configured admin account) and clicking the link, the existing admin UI renders.

- [ ] **Step 8: Commit**

```bash
git add client/admin/auth.ts client/admin/main.ts client/admin/App.svelte tests/client/admin/whoami-bootstrap.test.ts
git commit -m "feat(client-admin): gate admin UI on /auth/whoami; add sign-in screen and logout"
```

---

## Task 12: Client login screen + logout (debug UI)

**Files:**

- Modify: `client/debug/main.ts`
- Create: `client/debug/auth.ts` (mirror of admin one — both can later be moved to `client/shared/` but YAGNI for v1)

- [ ] **Step 1: Copy the admin auth module pattern**

Create `client/debug/auth.ts` with the same `ensureAuthenticated()` + `logout()` exports as Task 11. (Different file because the two clients are bundled separately under `client/debug/` and `client/admin/` per `bun:client` config.)

- [ ] **Step 2: Gate the debug mount**

Repeat the Task 11 step 5 wiring in `client/debug/main.ts`.

- [ ] **Step 3: Manual smoke test**

Run: `bun start:debug`
Expected: `/debug` shows the same sign-in screen until a session exists.

- [ ] **Step 4: Commit**

```bash
git add client/debug/auth.ts client/debug/main.ts
git commit -m "feat(client-debug): gate debug UI on /auth/whoami"
```

---

## Task 13: Deployment docs (Step 1)

**Files:**

- Create: `docs/deployment/dashboard-access.md`
- Modify: `CLAUDE.md` (env-vars section: drop `DEBUG_TOKEN`, add `DASHBOARD_BASE_URL`, `DASHBOARD_SESSION_TTL_SECONDS`, `DASHBOARD_CLAIM_TTL_SECONDS`, plus `/dashboard` description)

- [ ] **Step 1: Write `docs/deployment/dashboard-access.md`**

````md
# Dashboard access patterns

The debug/admin dashboard binds to `DEBUG_HOSTNAME` (default `127.0.0.1`) on `DEBUG_PORT` (default `9100`). The application's session-cookie auth assumes one of the following deployment patterns; **do not expose the dashboard on a public interface without one**.

## 1. SSH local forward (baseline)

```bash
ssh -L 9100:127.0.0.1:9100 user@host
```
````

Browse to `http://127.0.0.1:9100/admin`. DM `/dashboard` to the bot, click the link.

## 2. Tailscale Serve / tailnet-only bind

Set `DEBUG_HOSTNAME=100.x.y.z` (your tailnet IP) and visit from another tailnet device. Optionally configure Tailscale Serve to expose `/admin` under a magicdns hostname.

## 3. Reverse proxy with upstream OIDC

Run the bot behind oauth2-proxy / Authelia / authentik / Cloudflare Access. The dashboard's session cookie still applies inside that perimeter — it is a defense in depth, not a replacement for upstream identity.

## Required configuration

- `ADMIN_USER_ID` must match the chat platform user ID of the admin who will run `/dashboard`.
- `DASHBOARD_BASE_URL` should be the externally-reachable origin of the dashboard if it differs from `http://{DEBUG_HOSTNAME}:{DEBUG_PORT}`.
- For HTTPS deployments, the reverse proxy must forward `X-Forwarded-Proto: https` so the bot emits the `Secure` cookie attribute.

## Sign-in flow

1. Operator DMs `/dashboard` to the bot.
2. Bot replies with a single-use URL valid for 5 minutes.
3. Clicking the link sets a `HttpOnly; Secure; SameSite=Strict` cookie scoped to `/` and redirects to `/admin`.
4. Session lasts 8 hours by default. `POST /auth/logout` revokes immediately.

````

- [ ] **Step 2: Update `CLAUDE.md`**

Remove the `DEBUG_TOKEN` env documentation line. Add a short paragraph under "DEBUG_SERVER" describing the new flow:

```md
When `DEBUG_SERVER=true`, the dashboard requires a session cookie minted via the bot. DM `/dashboard` to receive a one-time sign-in link (TTL 5 min). Sessions last `DASHBOARD_SESSION_TTL_SECONDS` (default 8h). See `docs/deployment/dashboard-access.md` for recommended deployment patterns.

| Var | Required | Default | Purpose |
|---|---|---|---|
| `DASHBOARD_BASE_URL` | no | `http://{DEBUG_HOSTNAME}:{DEBUG_PORT}` | URL embedded in the magic link |
| `DASHBOARD_SESSION_TTL_SECONDS` | no | `28800` | session lifetime |
| `DASHBOARD_CLAIM_TTL_SECONDS` | no | `300` | sign-in link lifetime |
````

- [ ] **Step 3: Commit**

```bash
git add docs/deployment/dashboard-access.md CLAUDE.md
git commit -m "docs(dashboard-auth): document session-cookie auth and deployment patterns"
```

---

## Task 14: Final cleanup pass

- [ ] **Step 1: grep for stragglers**

Run:

```bash
grep -rn "DEBUG_TOKEN" src/ client/ tests/ docs/ CLAUDE.md
```

Expected: only the `warnIfLegacyDebugToken` source + the deprecation message strings should match. Anything else must be removed.

- [ ] **Step 2: Run full check pipeline**

Run: `bun check:full`
Expected: all checks pass. Fix any lint/format/typecheck/test fallout.

- [ ] **Step 3: Run the explicit test suites the change touches**

Run: `bun test tests/db/migrations/ tests/dashboard-auth/ tests/debug/ tests/commands/dashboard.test.ts && bun test:client tests/client/admin/`
Expected: green.

- [ ] **Step 4: Commit any incidental cleanup**

```bash
git add -A
git commit -m "chore(dashboard-auth): remove residual DEBUG_TOKEN references"
```

---

## Self-Review

**Spec coverage:**

- Replace `DEBUG_TOKEN` with sessions → Tasks 6, 8, 10 (warning).
- Two new tables → Task 1.
- Auth module with claim/session/sweeper → Tasks 2, 3, 4, 5.
- `/auth/claim` + `/auth/logout` + `/auth/whoami` → Task 7.
- `/dashboard` chat command → Task 9.
- Client login screen + logout → Tasks 11, 12.
- Deployment docs + CLAUDE.md updates → Task 13.
- Cleanup → Task 14.

**Placeholder scan:** No "TBD" or "similar to" leftovers. Every code step contains real code.

**Type consistency:** `SESSION_COOKIE_NAME`, `mintSession`, `authenticate`, `consumeClaim`, `issueClaim`, `revokeSession`, `sweepExpired`, `recordActivity` are defined in Tasks 2–4 with the exact signatures used by Tasks 6–10. The `__routeRequestForTest` test handle is exported in Task 6 and consumed by Tasks 6–8.

**Risk note:** Task 11/12 manual smoke tests are the only place we exercise the end-to-end flow against a real chat platform. Confirm by DMing `/dashboard` from your admin account to a running bot before merging.
