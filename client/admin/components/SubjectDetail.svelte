<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Panel from '../../shared/ui/Panel.svelte'
  import StatusPill from '../../shared/ui/StatusPill.svelte'
  import { formatDateTime } from '../../shared/helpers.js'
  import type { BillingDetail, BillingRequestRow } from '../../shared/api-types.js'
  import { fetchRecentRequests } from '../fetchers.js'
  import type { RecentRequestRow } from '../fetcher-schemas.js'

  interface Props {
    detail: BillingDetail
  }

  let { detail }: Props = $props()

  let expanded: Set<string> = $state(new Set())
  let recentRequests = $state<RecentRequestRow[]>([])

  function toggle(eventId: string): void {
    if (expanded.has(eventId)) expanded.delete(eventId)
    else expanded.add(eventId)
    expanded = new Set(expanded)
  }

  function renderJson(row: BillingRequestRow): string {
    return JSON.stringify(row, null, 2)
  }

  $effect(() => {
    const id = detail.subject.storageContextId
    void (async () => {
      recentRequests = await fetchRecentRequests(id, 25)
    })()
  })
</script>

<section class="subject-detail">
  <h3>
    Requests for {detail.subject.displayName ?? detail.subject.storageContextId}
    <span class="count-badge">{detail.requests.length}</span>
  </h3>
  {#if detail.truncated}
    <div class="truncation-banner">
      Result truncated. Showing the most recent {detail.requests.length} requests; narrow the window for more.
    </div>
  {/if}
  {#if detail.requests.length === 0}
    <span class="placeholder">No requests in this window</span>
  {:else}
    <table class="admin-subject__requests">
      <thead>
        <tr>
          <th>When (UTC)</th>
          <th>Role</th>
          <th>Model</th>
          <th class="num">In</th>
          <th class="num">Out</th>
          <th class="num">Steps</th>
          <th class="num">Tools</th>
          <th class="num">Msgs</th>
          <th class="num">Dur</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        {#each detail.requests as row (row.eventId)}
          <tr
            class="admin-subject__row"
            data-testid="request-row"
            onclick={() => toggle(row.eventId)}
            onkeydown={(event: KeyboardEvent) => {
              if (event.key === 'Enter' || event.key === ' ') toggle(row.eventId)
            }}
            tabindex="0"
            role="button">
            <td>{formatDateTime(row.occurredAt)}</td>
            <td>{row.modelRole}</td>
            <td>{row.model}</td>
            <td class="num">{row.inputTokens ?? '—'}</td>
            <td class="num">{row.outputTokens ?? '—'}</td>
            <td class="num">{row.stepCount}</td>
            <td class="num">{row.toolCallCount}</td>
            <td class="num">{row.messageCount}</td>
            <td class="num">{row.durationMs}ms</td>
            <td class="admin-subject__err">{row.error ?? ''}</td>
          </tr>
          {#if expanded.has(row.eventId)}
            <tr>
              <td colspan="10">
                <pre data-testid="request-json">{renderJson(row)}</pre>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}

  <Panel title="recent requests">
    {#snippet body()}
      {#if recentRequests.length === 0}
        <p class="admin-subject__empty">no recent activity</p>
      {:else}
        <table class="admin-subject__requests">
          <thead>
            <tr>
              <th>When (UTC)</th>
              <th>Model</th>
              <th>Role</th>
              <th class="num">In</th>
              <th class="num">Out</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {#each recentRequests as r (r.ts)}
              <tr>
                <td>{formatDateTime(r.ts)}</td>
                <td>{r.modelLabel}</td>
                <td>{r.role}</td>
                <td class="num">{r.inputTokens}</td>
                <td class="num">{r.outputTokens}</td>
                <td><StatusPill status={r.finishStatus} /></td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {/snippet}
  </Panel>
</section>

<style>
  .subject-detail h3 {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg3);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .count-badge {
    font-size: 11px;
    font-weight: 500;
    color: var(--fg4);
    background: var(--surface2);
    padding: 1px 6px;
    border-radius: 10px;
  }
  .truncation-banner {
    margin-bottom: 8px;
    padding: 6px 10px;
    font-size: 11px;
    color: var(--fg3);
    background: var(--surface2);
    border-radius: 6px;
  }
  .admin-subject__requests {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .admin-subject__requests th {
    text-align: left;
    color: var(--fg3);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    border-bottom: 1px solid var(--hair);
    padding: 6px 8px;
    position: sticky;
    top: 0;
    background: var(--surface);
  }
  .admin-subject__requests td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--hair);
    color: var(--fg);
    white-space: nowrap;
  }
  .admin-subject__requests th.num,
  .admin-subject__requests td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .admin-subject__row {
    cursor: pointer;
  }
  .admin-subject__row:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  .admin-subject__err {
    color: var(--danger);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .admin-subject__requests pre {
    margin: 0;
    padding: 8px 12px;
    font-size: 11px;
    color: var(--fg2);
    background: var(--surface2);
    border-radius: 6px;
    overflow-x: auto;
    white-space: pre;
  }
  .admin-subject__empty {
    padding: 12px;
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 12px;
    margin: 0;
  }
  .placeholder {
    display: block;
    padding: 16px;
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 12px;
  }
</style>
