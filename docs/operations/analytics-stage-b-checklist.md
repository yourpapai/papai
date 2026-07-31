<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Stage A → Stage B execution checklist

> Self-contained operator guide: Stage A sign-off → merge → deploy → Stage B
> two-week evidence window → Stage B exit. Authoritative sources:
> `docs/operations/analytics-runbook.md` (rollout semantics),
> `docs/superpowers/specs/2026-07-28-analytics-stage-b-design.md` (operations
> design), `docs/research/analytics-metrics/09-stage-a-evidence.md` (evidence
> doc of record). Incident response: `docs/operations/analytics-incident-runbook.md`.

**Deployment-specific values — adjust to your environment:**

| Placeholder | Example value | Meaning |
|---|---|---|
| `<PROD_HOST>` | `papai-prod` | production host (SSH alias) |
| `<PAPAI_DIR>` | `/opt/papai` | install directory on the host |
| `<DB_PATH>` | `/var/lib/papai/papai.db` | SQLite DB path (same as the bot's `DB_PATH`) |
| `<SNAPSHOT_DIR>` | `/var/lib/papai/snapshots` | `ANALYTICS_SNAPSHOT_DIR` |

**docker compose deployments:** the operator CLIs ship inside the image at
`/app/scripts/`; run them as `docker compose exec papai bun run /app/scripts/<name>.ts`
(`DB_PATH` is already set by the compose `environment:`, and the CLI opens the DB
read-only). No host checkout is needed; use `docker compose exec -T` from cron.

**Never during the window:** deploy or restart the bot (an unclean restart =
`unreconciled_restart_gap` day = the two-week counter restarts); amend an
evidence commit (corrections land as new commits); estimate or backfill a
missed/gap day (unknown = ineligible, no exceptions); enable any external
sink.

---

## 1. Sign the Stage A exit (prerequisite for merge)

- [ ] Open `docs/research/analytics-metrics/09-stage-a-evidence.md`. Verify:
  - Privacy-contract control matrix: all 17 rows green.
  - Stage A exit checklist: every box checked except the signature line.
  - Stage B readiness evidence table: all rows filled (no placeholders).
- [ ] Privacy/security owner reviews and signs:

  ```markdown
  **Privacy/security owner signature:** <name>  date: <YYYY-MM-DD>
  ```

- [ ] Commit and push:

  ```bash
  git add docs/research/analytics-metrics/09-stage-a-evidence.md
  git commit -m "docs(research): stage A exit sign-off"
  git push
  ```

## 2. Merge PR #185

- [ ] Verify CI green and head is current:

  ```bash
  gh pr checks 185
  gh pr view 185 --json headRefOid -q .headRefOid   # expect ae87155e0 or later
  ```

- [ ] Merge (merge commit, repo convention): `gh pr merge 185 --merge` or the GitHub UI.
- [ ] Local sync: `git checkout master && git pull`.

## 3. Deploy dormant (Stage A posture in production)

- [ ] Deploy master to `<PROD_HOST>` per your normal process, keeping
      **`ANALYTICS_KILL_SWITCH=1` set** in the deployment environment.
- [ ] Verify migrations 072–075 applied (bot startup logs: `Database connection created for migrations`; no errors).
- [ ] Verify dormant (on `<PROD_HOST>`):

  ```bash
  sqlite3 <DB_PATH> "SELECT COUNT(*) FROM analytics_events;"      # expect 0
  sqlite3 <DB_PATH> "SELECT COUNT(*) FROM analytics_deliveries;"  # expect 0
  sqlite3 <DB_PATH> "SELECT COUNT(*) FROM analytics_aggregate_deliveries;"  # expect 0
  ```

- [ ] Verify the report CLI works read-only:

  ```bash
  DB_PATH=<DB_PATH> bun run <PAPAI_DIR>/scripts/analytics-stage-b-report.ts
  # docker compose: docker compose exec papai bun run /app/scripts/analytics-stage-b-report.ts
  # expect: day=<yesterday> eligible=... summary + a window-log-row; exit 0
  ```

- [ ] Optional concurrency check:

  ```bash
  sqlite3 <DB_PATH> "PRAGMA journal_mode;"   # expect: wal
  ```

## 4. Flip to Stage B (start the window)

Do this any time **after** the dormant deploy is verified; window day 1 is the
**next UTC midnight** after the flip.

- [ ] Set the policy (settings UI path — recommended): open the `/settings`
      admin analytics section as super admin, set **Local mode** to
      `local_aggregate`, save. (API equivalent:
      `PATCH /settings/api/admin/analytics` with
      `{"localMode": "local_aggregate", "expectedConfigVersion": <current>}` —
      requires the admin session + CSRF header; the UI handles both.)
- [ ] Remove `ANALYTICS_KILL_SWITCH=1` from the deployment environment. The
      running process re-reads it at each lanes resolution — no restart
      required if the env can be mutated in place. If your deployment needs a
      restart for env changes, restart NOW (before the window starts, so it
      costs no gap day).
- [ ] Verify lanes resolved (bot logs or the admin analytics view):
      `localMode=local_aggregate`, kill switch inactive, externals off.
- [ ] Record the window header in the evidence doc, section **Stage B window
      log (post-merge, operational)**:

  ```markdown
  - Deploy date / version: <YYYY-MM-DD> / <merge commit sha>
  - Window start (UTC): <YYYY-MM-DD of the next UTC midnight>
  ```

  Commit: `docs(research): stage B window opened <date>`.

## 5. One-time daily collection setup

- [ ] Add cron on `<PROD_HOST>` (`crontab -e`):

  ```cron
  CRON_TZ=UTC
  15 0 * * * DB_PATH=<DB_PATH> /usr/local/bin/bun <PAPAI_DIR>/scripts/analytics-stage-b-report.ts --log /var/lib/papai/stage-b.jsonl >> /var/log/papai/stage-b.log 2>&1
  ```

  Absolute paths everywhere; `--log` keeps machine history even on skipped
  days; non-zero exit mails the operator (that day = `unknown` = ineligible).
- [ ] Dry-run the exact cron command once by hand; confirm one JSON line
      appended to `/var/lib/papai/stage-b.jsonl`.

## 6. Daily ritual (10 minutes, every day of the window)

- [ ] SSH to `<PROD_HOST>` and run (or read the cron output):

  ```bash
  DB_PATH=<DB_PATH> bun run <PAPAI_DIR>/scripts/analytics-stage-b-report.ts
  ```

- [ ] Read the output and apply the decision tree:

  ```text
  eligible=true
  └─ paste the row, done (rejects > 0 is fine — record them)

  eligible=false, reason=restart_gap
  ├─ day suppressed → the consecutive-week counter RESTARTS
  ├─ find the unclean restart in bot logs/deploy events; note cause in Notes
  └─ no rollback by itself; two NEW consecutive weeks required from tomorrow

  eligible=false, reason=delta
  ├─ INCIDENT → docs/operations/analytics-incident-runbook.md
  ├─ decide: rollback (set ANALYTICS_KILL_SWITCH=1 + PATCH local_mode=off)
  │  vs continue investigating
  ├─ privacy finding (C3/raw-ID/guest continuity) → Stage A posture + notify
  │  the privacy/security owner
  └─ window restarts only after status=reconciled returns

  any field = unknown
  ├─ day ineligible, no exceptions — never estimate or backfill
  ├─ tooling bug? fix the CLI; the day still does not count
  └─ missed CLI day = unknown day (cron --log is the backup)

  NOTE: reconciliation=gap with reason=ok means the gap belongs to an earlier
  day (its own row is suppressed) — this day is fine, no incident.
  ```

- [ ] Paste the printed `window-log-row` into the **Daily log (report CLI
      rows)** table in `09-stage-a-evidence.md`, then commit from your local
      repo checkout:

  ```bash
  git add docs/research/analytics-metrics/09-stage-a-evidence.md
  git commit -m "docs(research): stage B day <YYYY-MM-DD> evidence"
  git push
  ```

- [ ] Hard rules: one commit per day; never amend evidence commits; never mark
      a day eligible retroactively.

## 7. Weekly ritual (45 minutes, end of week 1 and week 2)

Per `docs/operations/analytics-runbook.md` §Recurring schedule → Weekly:

- [ ] Data health: snapshot freshness, reconciliation zero-delta on every
      closed epoch, rejects, eligibility coverage, censored share, suppression.
- [ ] Storage/expiry: table-size trend within the expiry envelope; retention
      purge runs; earliest deadline sane.
- [ ] Dashboards: Metabase cards show snapshot timestamps; freshness warning
      not active; query p95 acceptable (record it).
- [ ] Fill the weekly summary row in the evidence doc's weekly table
      (aggregate the 7 daily rows: worst freshness, delta sum = 0, reject
      total, overflow total, worst expiry).
- [ ] Commit: `docs(research): stage B week <N> summary`.

## 8. Window end (after ≥14 consecutive eligible days)

- [ ] Run the assessment on `<PROD_HOST>`:

  ```bash
  DB_PATH=<DB_PATH> bun run <PAPAI_DIR>/scripts/analytics-stage-b-report.ts \
    --assess --log /var/lib/papai/stage-b.jsonl
  # expect: consecutive_complete_weeks=2 stage_b_exit=allowed stage_c_entry=allowed|refused(...)
  ```

- [ ] Verify exit criteria against the daily rows (runbook §Stage B exit):
      two consecutive complete UTC weeks; every contributing epoch closed
      cleanly; zero unexplained delta; zero C3/raw-ID/guest-continuity
      findings; bounded overflow; verified expiry; snapshot/query SLO
      recorded in the weekly reviews.
- [ ] In the evidence doc: fill `Window end (UTC)`, paste the assess output
      verbatim below the weekly table, sign:

  ```markdown
  **Stage B exit review:** <engineering owner> + <product/UX owner>  date: <YYYY-MM-DD>
  ```

  (The privacy/security owner signs additionally if any privacy-relevant
  finding occurred during the window.)
- [ ] Commit: `docs(research): stage B exit evidence — window <start>..<end>`, push.
- [ ] If the window failed (<2 consecutive weeks): nothing to sign — keep
      collecting; the counter is already running from the last clean day.

## 9. Rollback quick reference

| Trigger | Action |
|---|---|
| Any privacy finding | Set `ANALYTICS_KILL_SWITCH=1` (env, no restart needed); `PATCH local_mode=off` for a durable stop; return to Stage A posture; incident runbook |
| Repeated reconciliation delta | Same as above; investigate with `POST /settings/api/admin/analytics/reconcile` `{"apply": false}` |
| Suspect tooling (CLI/report) bug | Fix forward; affected days stay ineligible — never re-mark |

## After Stage B: Stage C entry

- [ ] `stage_c_entry=allowed` from the assess run **and** governance readiness
      complete (policy/notice versions, controller contact, purpose, lawful
      basis, retention horizon, review date, operator acknowledgement, both
      keyrings `ANALYTICS_HMAC_KEYRING` + `ANALYTICS_GOVERNANCE_HMAC_KEYRING`).
- [ ] Plan the governed local pseudonymous pilot (runbook §Stage C): explicit
      test actors only, export/withdraw/delete exercise, hand-calculated
      verification, rekey drill.
- [ ] The message-edit analytics (edit funnel) deploys with the Stage C flip
      or any post-window deploy — never mid-window.
