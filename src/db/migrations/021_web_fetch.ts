import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

function createWebCacheTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS web_cache (
      url_hash     TEXT PRIMARY KEY,
      url          TEXT NOT NULL,
      final_url    TEXT NOT NULL,
      title        TEXT NOT NULL,
      summary      TEXT NOT NULL,
      excerpt      TEXT NOT NULL,
      truncated    INTEGER NOT NULL DEFAULT 0,
      content_type TEXT NOT NULL,
      fetched_at   INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_web_cache_expires ON web_cache(expires_at)`)
}

function createWebRateLimitTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS web_rate_limit (
      actor_id     TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      count        INTEGER NOT NULL,
      PRIMARY KEY (actor_id, window_start)
    )
  `)
}

export const migration021WebFetch: Migration = {
  id: '021_web_fetch',
  up(db: Database): void {
    createWebCacheTable(db)
    createWebRateLimitTable(db)
  },
}
