<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Caption from '../../shared/ui/Caption.svelte'

  import FailureDetail from './FailureDetail.svelte'
  import LogDetail from './LogDetail.svelte'
  import SessionDetail from './SessionDetail.svelte'
  import TraceDetail from './TraceDetail.svelte'
  import TurnDetail from './TurnDetail.svelte'

  import type { SelectedDetail } from '../dashboard-types.js'

  interface Props {
    selected: SelectedDetail
    onClear: () => void
  }

  let { selected, onClear }: Props = $props()

  const headerLabel = $derived.by(() => {
    if (selected === null) return ''
    switch (selected.kind) {
      case 'turn':
        return `turn · ${selected.payload.turnId}`
      case 'trace':
        return `trace · ${selected.payload.model}`
      case 'session':
        return `session · ${selected.payload.userId}`
      case 'log':
        return `log · #${selected.payload.index + 1}`
      case 'failure': {
        const tn = selected.payload.data['toolName']
        return `failure · ${typeof tn === 'string' ? tn : 'unknown'}`
      }
    }
  })
</script>

<div class="debug-detail-rail">
  {#if selected === null}
    <div class="debug-detail-rail__empty">
      <Caption>{#snippet children()}detail rail{/snippet}</Caption>
      <p class="debug-detail-rail__hint">select a turn, trace, session, log, or failure</p>
    </div>
  {:else}
    <div class="debug-detail-rail__header">
      <span class="debug-detail-rail__label">{headerLabel}</span>
      <button class="debug-detail-rail__close" onclick={onClear}>✕</button>
    </div>
    <div class="debug-detail-rail__body">
      {#if selected.kind === 'turn'}
        <TurnDetail turn={selected.payload} />
      {:else if selected.kind === 'trace'}
        <TraceDetail trace={selected.payload} />
      {:else if selected.kind === 'session'}
        <SessionDetail userId={selected.payload.userId} session={selected.payload.session} />
      {:else if selected.kind === 'log'}
        <LogDetail entry={selected.payload.entry} />
      {:else if selected.kind === 'failure'}
        <FailureDetail failure={selected.payload} />
      {/if}
    </div>
  {/if}
</div>

<style>
  .debug-detail-rail {
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    min-height: 0;
    min-width: 0;
  }
  .debug-detail-rail__empty {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .debug-detail-rail__hint {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 12px;
    margin: 0;
  }
  .debug-detail-rail__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--hair);
  }
  .debug-detail-rail__label {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg2);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .debug-detail-rail__close {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--fg2);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 2px;
  }
  .debug-detail-rail__close:hover {
    background: var(--raised);
  }
  .debug-detail-rail__body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 14px;
  }
</style>
