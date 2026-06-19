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
    onSelect: () => void
  }

  let { userId, session, wizard, isOperator = false, onSelect }: Props = $props()

  const isActive = $derived(Date.now() - session.lastAccessed < 300000)
</script>

<div
  class="session-card"
  class:active={isActive}
  class:operator={isOperator}
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
    padding: 10px 12px;
    border-bottom: 1px solid var(--hair);
    line-height: 1.45;
    cursor: pointer;
  }

  .session-detail,
  .wizard-badge {
    display: block;
    margin-top: 2px;
  }

  .session-card.operator {
    border-left: 2px solid var(--accent);
    background: rgba(93, 217, 122, 0.05);
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
