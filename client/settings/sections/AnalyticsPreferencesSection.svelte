<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Confirm from '../../shared/Confirm.svelte'
  import Btn from '../../shared/ui/Btn.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import SegmentedControl from '../../shared/ui/SegmentedControl.svelte'
  import {
    deleteAnalyticsData,
    exportAnalyticsData,
    fetchAnalyticsPreferences,
    putAnalyticsPreferences,
    withdrawAnalytics,
  } from '../analytics-fetchers.js'
  import type { AnalyticsPreferencesResponse } from '../fetcher-schemas-analytics.js'

  const CHOICE_OPTIONS = [
    { value: 'allow', label: 'Allow' },
    { value: 'deny', label: 'Deny' },
  ] as const

  let data = $state<AnalyticsPreferencesResponse | null>(null)
  let loadError: string | null = $state(null)
  let actionError: string | null = $state(null)
  let announcement: string | null = $state(null)
  let busy = $state(false)
  let confirming: 'withdraw' | 'delete' | null = $state(null)

  function messageFrom(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  async function load(): Promise<void> {
    loadError = null
    actionError = null
    try {
      data = await fetchAnalyticsPreferences()
    } catch (err) {
      loadError = messageFrom(err)
    }
  }

  async function run(action: () => Promise<string>): Promise<void> {
    if (busy) return
    actionError = null
    announcement = null
    busy = true
    try {
      announcement = await action()
    } catch (err) {
      actionError = messageFrom(err)
    } finally {
      busy = false
    }
  }

  async function choose(lane: 'localLongitudinal' | 'externalPseudonymous', value: string): Promise<void> {
    if (value !== 'allow' && value !== 'deny') return
    await run(async () => {
      const preference = await putAnalyticsPreferences({ [lane]: value })
      if (data !== null) data = { ...data, preference }
      return 'Preference saved.'
    })
  }

  function downloadJson(filename: string, payload: unknown): void {
    if (typeof URL.createObjectURL !== 'function') return
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function exportData(): Promise<void> {
    await run(async () => {
      const result = await exportAnalyticsData()
      downloadJson(result.filename, result.data)
      return 'Export ready — analytics data only.'
    })
  }

  async function confirmWithdraw(): Promise<void> {
    await run(async () => {
      const result = await withdrawAnalytics()
      confirming = null
      await load()
      return `Withdrawn. Removed ${result.eventsRemoved} event(s) and applied ${result.censorsApplied} censor(s).`
    })
  }

  async function confirmDelete(): Promise<void> {
    await run(async () => {
      const result = await deleteAnalyticsData()
      confirming = null
      return `Deletion ${result.status} (analytics only).`
    })
  }

  const effectiveText = $derived(
    data === null
      ? ''
      : `Local longitudinal: ${data.preference.localLongitudinal} · External pseudonymous: ${data.preference.externalPseudonymous}` +
          (data.preference.effectiveAtMs === null
            ? ''
            : ` · effective ${new Date(data.preference.effectiveAtMs).toLocaleString()}`),
  )

  $effect(() => {
    void load()
  })
</script>

<section id="analytics" class="settings-section">
  <PageHeader eyebrow="Personal" title="Analytics" />

  {#if loadError !== null && data === null}
    <ErrorState title="Couldn't load analytics preferences" message={loadError} onRetry={() => void load()} />
  {:else if data === null}
    <p class="placeholder" data-testid="analytics-loading">Loading…</p>
  {:else}
    <p class="settings-section__caption" data-testid="analytics-notice">
      Purpose: {data.notice.purpose ?? 'not published yet'} · Controller: {data.notice.controllerContact ?? 'not published yet'}
      {#if data.notice.policyVersion !== null}· Policy v{data.notice.policyVersion}{/if}
    </p>
    <p class="settings-section__caption" data-testid="analytics-explanation">{data.explanation}</p>
    <p class="settings-section__caption">These choices apply to your own account only — never to a group or another member.</p>

    <div class="settings-field">
      <span class="settings-field__label" id="analytics-local-label">Local longitudinal analytics</span>
      <SegmentedControl
        options={CHOICE_OPTIONS}
        value={data.preference.localLongitudinal}
        ariaLabel="Local longitudinal analytics"
        ariaDescribedBy="analytics-local-label"
        testidPrefix="analytics-local"
        disabled={busy || !data.subjectRightsAvailable}
        onChange={(value) => void choose('localLongitudinal', value)} />
    </div>

    <div class="settings-field">
      <span class="settings-field__label" id="analytics-external-label">External pseudonymous analytics</span>
      <SegmentedControl
        options={CHOICE_OPTIONS}
        value={data.preference.externalPseudonymous}
        ariaLabel="External pseudonymous analytics"
        ariaDescribedBy="analytics-external-label"
        testidPrefix="analytics-external"
        disabled={busy || !data.subjectRightsAvailable}
        onChange={(value) => void choose('externalPseudonymous', value)} />
    </div>

    <p class="settings-section__caption" data-testid="analytics-effective">{effectiveText}</p>

    <div class="settings-actions">
      <Btn variant="outline" size="sm" disabled={busy} testid="analytics-export" onClick={() => void exportData()}>
        {#snippet children()}Export analytics data{/snippet}
      </Btn>
      <Btn
        variant="outline"
        size="sm"
        disabled={busy || !data.subjectRightsAvailable}
        testid="analytics-withdraw"
        onClick={() => (confirming = 'withdraw')}>
        {#snippet children()}Withdraw consent{/snippet}
      </Btn>
      <Btn
        variant="danger"
        size="sm"
        disabled={busy || !data.subjectRightsAvailable}
        testid="analytics-delete"
        onClick={() => (confirming = 'delete')}>
        {#snippet children()}Delete analytics data{/snippet}
      </Btn>
    </div>

    {#if actionError !== null}
      <p class="status-error" role="alert" data-testid="analytics-error">{actionError}</p>
    {/if}
    {#if announcement !== null}
      <p class="status-success" role="status" data-testid="analytics-success">{announcement}</p>
    {/if}
  {/if}
</section>

<Confirm
  open={confirming === 'withdraw'}
  title="Withdraw analytics consent"
  danger
  {busy}
  confirmLabel="Withdraw analytics consent"
  onCancel={() => (confirming = null)}
  onConfirm={() => void confirmWithdraw()}>
  {#snippet body()}
    <p>This stops future analytics collection for your account and deletes your retained analytics data.</p>
  {/snippet}
</Confirm>

<Confirm
  open={confirming === 'delete'}
  title="Delete analytics data"
  danger
  {busy}
  confirmLabel="Delete my analytics data"
  onCancel={() => (confirming = null)}
  onConfirm={() => void confirmDelete()}>
  {#snippet body()}
    <p>This deletes your retained analytics data (analytics stores only). This cannot be undone.</p>
  {/snippet}
</Confirm>

<style>
  .settings-section__caption {
    margin: 0 0 var(--gap-inline);
    font-size: 12px;
    color: var(--fg3);
    line-height: 1.45;
  }
  .settings-field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: var(--gap-inline);
  }
  .settings-field__label {
    font-size: 13px;
  }
</style>
