<script lang="ts">
  import type { Session, DashboardWizard } from '../dashboard-types.js'

  interface Props {
    userId: string
    session: Session
    wizard?: DashboardWizard
    onSelect: () => void
  }

  let { userId, session, wizard, onSelect }: Props = $props()

  const isActive = $derived(Date.now() - session.lastAccessed < 300000)
</script>

<div
  class="session-card"
  class:active={isActive}
  role="button"
  tabindex="0"
  onclick={onSelect}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }}>
  <div class="user-id">{userId}</div>
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
