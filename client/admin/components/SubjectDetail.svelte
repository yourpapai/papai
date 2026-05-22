<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Panel from '../../shared/ui/Panel.svelte'
  import { formatTime } from '../../shared/helpers.js'
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
    <table>
      <thead>
        <tr>
          <th>When</th>
          <th>Role</th>
          <th>Model</th>
          <th>In</th>
          <th>Out</th>
          <th>Steps</th>
          <th>Tools</th>
          <th>Msgs</th>
          <th>Dur</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        {#each detail.requests as row (row.eventId)}
          <tr
            data-testid="request-row"
            onclick={() => toggle(row.eventId)}
            onkeydown={(event: KeyboardEvent) => {
              if (event.key === 'Enter' || event.key === ' ') toggle(row.eventId)
            }}
            tabindex="0"
            role="button">
            <td>{formatTime(new Date(row.occurredAt).toISOString())}</td>
            <td>{row.modelRole}</td>
            <td>{row.model}</td>
            <td>{row.inputTokens ?? '-'}</td>
            <td>{row.outputTokens ?? '-'}</td>
            <td>{row.stepCount}</td>
            <td>{row.toolCallCount}</td>
            <td>{row.messageCount}</td>
            <td>{row.durationMs}ms</td>
            <td>{row.error ?? ''}</td>
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
              <th>ts</th>
              <th>model</th>
              <th>role</th>
              <th>in</th>
              <th>out</th>
              <th>status</th>
            </tr>
          </thead>
          <tbody>
            {#each recentRequests as r (r.ts)}
              <tr>
                <td>{new Date(r.ts).toISOString()}</td>
                <td>{r.modelLabel}</td>
                <td>{r.role}</td>
                <td>{r.inputTokens}</td>
                <td>{r.outputTokens}</td>
                <td>{r.finishStatus}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {/snippet}
  </Panel>
</section>

<style>
  .admin-subject__requests {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .admin-subject__requests th {
    text-align: left;
    color: var(--fg3);
    font-weight: normal;
    border-bottom: 1px solid var(--hair);
    padding: 4px 8px;
  }
  .admin-subject__requests td {
    padding: 4px 8px;
    border-bottom: 1px solid var(--hair);
    color: var(--fg);
  }
  .admin-subject__empty {
    padding: 12px;
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 12px;
    margin: 0;
  }
</style>
