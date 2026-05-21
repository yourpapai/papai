<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { formatTime } from '../../shared/helpers.js'
  import type { BillingDetail, BillingRequestRow } from '../../shared/api-types.js'

  interface Props {
    detail: BillingDetail
  }

  let { detail }: Props = $props()

  let expanded: Set<string> = $state(new Set())

  function toggle(eventId: string): void {
    if (expanded.has(eventId)) expanded.delete(eventId)
    else expanded.add(eventId)
    expanded = new Set(expanded)
  }

  function renderJson(row: BillingRequestRow): string {
    return JSON.stringify(row, null, 2)
  }
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
</section>
