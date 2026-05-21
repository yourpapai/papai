<script lang="ts">
  import { untrack } from 'svelte'

  import type { AdminLlmSnapshot, BillingSubject, BillingWindow } from '../../shared/api-types.js'
  import CredentialsForm from './CredentialsForm.svelte'
  import SubjectsTable from './SubjectsTable.svelte'
  import { fetchAdminLlm, fetchBillingSubjects } from './fetchers.js'

  interface BillingState {
    billingWindow: BillingWindow
    billingSubjects: BillingSubject[]
    adminLlm: AdminLlmSnapshot | null
  }

  interface Props {
    dashboard: BillingState
    onSelectSubject: (subject: BillingSubject) => void
  }

  let { dashboard, onSelectSubject }: Props = $props()

  let fetching = $state(false)
  let error: string | null = $state(null)

  const WINDOWS: readonly BillingWindow[] = ['24h', '7d', '30d', 'all']

  async function loadSubjects(): Promise<void> {
    try {
      const { subjects } = await fetchBillingSubjects(dashboard.billingWindow)
      dashboard.billingSubjects = subjects
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function loadAdmin(): Promise<void> {
    try {
      dashboard.adminLlm = await fetchAdminLlm()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function refreshAll(): Promise<void> {
    error = null
    fetching = true
    try {
      await Promise.all([loadSubjects(), loadAdmin()])
    } finally {
      fetching = false
    }
  }

  function onWindowChange(event: Event): void {
    const target = event.currentTarget
    if (!(target instanceof HTMLSelectElement)) return
    const next = target.value
    if (next === '24h' || next === '7d' || next === '30d' || next === 'all') {
      dashboard.billingWindow = next
      void loadSubjects()
    }
  }

  // Initial load on mount: untrack to avoid reactivity loops on `fetching`.
  $effect(() => {
    untrack(() => {
      void refreshAll()
    })
  })
</script>

<section class="panel billing-panel">
  <header class="billing-header">
    <h2>Billing</h2>
    <label>
      Window:
      <select
        data-testid="billing-window-select"
        value={dashboard.billingWindow}
        onchange={onWindowChange}>
        {#each WINDOWS as w (w)}
          <option value={w}>{w}</option>
        {/each}
      </select>
    </label>
    <button
      type="button"
      data-testid="billing-refresh"
      onclick={() => {
        void refreshAll()
      }}>{fetching ? 'Refreshing…' : 'Refresh'}</button>
    {#if error !== null}
      <span class="status-error">{error}</span>
    {/if}
  </header>

  <CredentialsForm snapshot={dashboard.adminLlm} onRefresh={loadAdmin} />
  <SubjectsTable subjects={dashboard.billingSubjects} onSelect={onSelectSubject} />
</section>
