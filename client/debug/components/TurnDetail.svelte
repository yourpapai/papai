<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { formatDuration, formatTime } from '../../shared/helpers.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import StatusPill from '../../shared/ui/StatusPill.svelte'
  import SummaryList from '../../shared/ui/SummaryList.svelte'
  import TreeView from '../../shared/TreeView.svelte'
  import { formatScope } from '../scope-label.js'
  import type { Turn } from '../dashboard-types.js'

  interface Props {
    turn: Turn
  }

  let { turn }: Props = $props()

  let showRaw = $state(false)

  const durationMs = $derived((turn.endedAt ?? Date.now()) - turn.startedAt)

  const basicInfo = $derived([
    { k: 'Turn ID', v: turn.turnId },
    { k: 'Scope', v: formatScope(turn.scope) },
    { k: 'Status', v: turn.status, pill: true },
    { k: 'Started', v: formatTime(turn.startedAt) },
    { k: 'Ended', v: turn.endedAt === undefined ? '—' : formatTime(turn.endedAt) },
    { k: 'Duration', v: formatDuration(durationMs) },
    { k: 'Messages', v: String(turn.incomingMessageCount) },
  ])
</script>

<div class="session-detail-section">
  <h4>Basic Info</h4>
  <SummaryList items={basicInfo} />
</div>

{#if turn.error !== undefined && turn.error !== ''}
  <div class="session-detail-section">
    <h4>Error</h4>
    <pre class="tool-json error">{turn.error}</pre>
  </div>
{/if}

{#if turn.toolCalls.length > 0}
  <div class="session-detail-section">
    <h4>Tool Calls ({turn.toolCalls.length})</h4>
    <div class="tool-calls-list">
      {#each turn.toolCalls as tc, i (i)}
        <div class="tool-call-item" class:error={!tc.ok}>
          <div class="tool-call-summary">
            <span class="tool-name">{tc.name}</span>
            <span class="tool-duration">{formatDuration(tc.durationMs)}</span>
            <StatusPill status={tc.ok ? 'ok' : 'failed'} />
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<div class="session-detail-section">
  <Btn variant="ghost" size="sm" onClick={() => (showRaw = !showRaw)}>
    {#snippet children()}{showRaw ? 'hide raw' : 'show raw'}{/snippet}
  </Btn>
  {#if showRaw}
    <div class="tree-container">
      <TreeView value={turn} />
    </div>
  {/if}
</div>
