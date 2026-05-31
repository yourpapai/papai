<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import type { BillingDetail, BillingSubject, BillingWindow } from '../../shared/api-types.js'
  import SubjectDetail from '../components/SubjectDetail.svelte'
  import SubjectStatsPanel from '../components/SubjectStatsPanel.svelte'
  import SubjectsTable from '../components/SubjectsTable.svelte'
  import { fetchBillingDetail, fetchBillingSubjects } from '../fetchers.js'
  import Panel from '../../shared/ui/Panel.svelte'

  let billingWindow: BillingWindow = $state('30d')
  let billingSubjects: BillingSubject[] = $state([])
  let billingDetail: BillingDetail | null = $state(null)
  let selectedSubject: BillingSubject | null = $state(null)
  let fetching = $state(false)
  let detailFetching = $state(false)
  let error: string | null = $state(null)
  let detailError: string | null = $state(null)

  async function loadSubjects(): Promise<void> {
    const { subjects } = await fetchBillingSubjects(billingWindow)
    billingSubjects = subjects
  }

  async function refreshAll(): Promise<void> {
    error = null
    fetching = true
    try {
      await loadSubjects()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      fetching = false
    }
  }

  async function selectSubject(subject: BillingSubject): Promise<void> {
    selectedSubject = subject
    billingDetail = null
    detailError = null
    detailFetching = true
    try {
      billingDetail = await fetchBillingDetail(subject.storageContextId, billingWindow)
    } catch (err) {
      detailError = err instanceof Error ? err.message : String(err)
    } finally {
      detailFetching = false
    }
  }

  $effect(() => {
    untrack(() => {
      void refreshAll()
    })
  })
</script>

<section id="billing" class="admin-section">
  <Panel title="Billing" count={billingSubjects.length}>
    {#snippet action()}
      <button
        type="button"
        class="billing-refresh-btn"
        data-testid="billing-refresh"
        onclick={() => {
          void refreshAll()
        }}>{fetching ? 'Refreshing...' : 'Refresh'}</button>
    {/snippet}
    {#snippet body()}
      {#if error !== null}
        <p class="status-error">{error}</p>
      {/if}
      <SubjectsTable subjects={billingSubjects} onSelect={(subject) => void selectSubject(subject)} />
    {/snippet}
  </Panel>

  {#if selectedSubject !== null}
    <Panel title={`subject detail · ${selectedSubject.displayName ?? selectedSubject.storageContextId}`}>
      {#snippet body()}
        <div class="billing-inline-detail">
          {#if detailFetching && billingDetail === null && detailError === null}
            <span class="placeholder">Loading...</span>
          {:else if detailError !== null}
            <p class="status-error">{detailError}</p>
          {:else if billingDetail !== null}
            <SubjectDetail detail={billingDetail} />
          {/if}
          <SubjectStatsPanel storageContextId={selectedSubject.storageContextId} />
        </div>
      {/snippet}
    </Panel>
  {/if}
</section>

<style>
  .billing-inline-detail {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 12px;
    padding: 12px;
  }

  .billing-refresh-btn {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    padding: 3px 8px;
    height: 22px;
    cursor: pointer;
    border-radius: 2px;
    background: transparent;
    color: var(--fg2);
    border: 1px solid transparent;
  }

  .billing-refresh-btn:hover {
    background: var(--raised);
  }
</style>
