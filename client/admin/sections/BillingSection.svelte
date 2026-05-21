<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import Modal from '../../shared/Modal.svelte'
  import type { BillingDetail, BillingSubject, BillingWindow } from '../../shared/api-types.js'
  import SubjectDetail from '../components/SubjectDetail.svelte'
  import SubjectStatsPanel from '../components/SubjectStatsPanel.svelte'
  import SubjectsTable from '../components/SubjectsTable.svelte'
  import WindowSelect from '../components/WindowSelect.svelte'
  import { fetchBillingDetail, fetchBillingSubjects } from '../fetchers.js'

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

  function onWindowChange(window: BillingWindow): void {
    billingWindow = window
    void refreshAll()
  }

  function closeDetail(): void {
    selectedSubject = null
    billingDetail = null
    detailError = null
  }

  $effect(() => {
    untrack(() => {
      void refreshAll()
    })
  })
</script>

<section class="panel billing-panel">
  <header class="billing-header">
    <div>
      <p class="eyebrow">Usage</p>
      <h2 data-testid="admin-section-title">Billing</h2>
    </div>
    <WindowSelect value={billingWindow} onChange={onWindowChange} />
    <button
      type="button"
      data-testid="billing-refresh"
      onclick={() => {
        void refreshAll()
      }}>{fetching ? 'Refreshing...' : 'Refresh'}</button>
  </header>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {/if}

  <SubjectsTable subjects={billingSubjects} onSelect={(subject) => void selectSubject(subject)} />
</section>

<Modal
  open={selectedSubject !== null}
  title={selectedSubject === null ? '' : `Billing: ${selectedSubject.displayName ?? selectedSubject.storageContextId}`}
  onClose={closeDetail}>
  {#snippet body()}
    {#if selectedSubject !== null}
      {#if detailFetching && billingDetail === null && detailError === null}
        <span class="placeholder">Loading...</span>
      {:else if detailError !== null}
        <p class="status-error">{detailError}</p>
      {:else if billingDetail !== null}
        <SubjectDetail detail={billingDetail} />
      {/if}
      <SubjectStatsPanel storageContextId={selectedSubject.storageContextId} />
    {/if}
  {/snippet}
</Modal>
