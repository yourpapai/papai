<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->
<script lang="ts">
  import type { Session, DashboardWizard } from '../dashboard-types.js'
  import StatusPill from '../../shared/ui/StatusPill.svelte'

  interface Props {
    userId: string
    session: Session
    wizard?: DashboardWizard
    isOperator?: boolean
    selected?: boolean
    onSelect: () => void
  }

  let { userId, session, wizard, isOperator = false, selected = false, onSelect }: Props = $props()

  const isActive = $derived(Date.now() - session.lastAccessed < 300000)
</script>

<div
  class="session-card"
  class:active={isActive}
  class:selected
  role="button"
  tabindex="0"
  onclick={onSelect}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }}>
  <div class="user-id">
    {userId}
    <StatusPill status={isActive ? 'active' : 'idle'} />
    {#if isOperator}<span class="operator-badge">you</span>{/if}
  </div>
  <div class="session-detail">
    history: {session.historyLength} · facts: {session.factsCount} · summary: {session.summary === null ? 'no' : 'yes'}
  </div>
  {#if session.configKeys.length > 0}
    <div class="session-detail">config: {session.configKeys.length} keys</div>
  {/if}
  {#if wizard !== undefined}
    <div class="wizard-badge">🧙 wizard step {wizard.currentStep}/{wizard.totalSteps}</div>
  {/if}
</div>

<style>
  .session-card {
    display: block;
    border-left: 2px solid var(--border);
    padding: 10px 12px;
    margin-bottom: 6px;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    line-height: 1.45;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .session-card:hover {
    background: var(--surface-2);
  }

  .session-card.active {
    border-left-color: var(--accent);
  }

  .user-id {
    color: var(--text);
    font-weight: 600;
  }

  .session-detail {
    display: block;
    margin-top: 2px;
    color: var(--text-dim);
  }

  .wizard-badge {
    display: block;
    margin-top: 2px;
    color: var(--warn);
    font-size: 10px;
  }

  .operator-badge {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 8px;
    padding: 0 5px;
    margin-left: 4px;
  }
</style>
