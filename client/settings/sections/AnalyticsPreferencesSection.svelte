<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Confirm from '../../shared/Confirm.svelte'
  import Btn from '../../shared/ui/Btn.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
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
  import SettingsFieldShell from '../components/SettingsFieldShell.svelte'
  import LiveRegion from '../../shared/ui/LiveRegion.svelte'
  import { formatFetchError } from '../../shared/format-error.js'
  import { deleteStatusMessage, laneHint, RIGHTS_UNAVAILABLE_TEXT } from './analytics-preferences-copy.js'

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
  let laneErrors = $state<{ localLongitudinal: string | null; externalPseudonymous: string | null }>({
    localLongitudinal: null,
    externalPseudonymous: null,
  })

  async function load(): Promise<void> {
    loadError = null
    actionError = null
    try {
      data = await fetchAnalyticsPreferences()
    } catch (err) {
      loadError = formatFetchError(err)
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
      actionError = formatFetchError(err)
    } finally {
      busy = false
    }
  }

  // Not routed through `run`: a failed save belongs under the control that failed, not in
  // the shared alert below the destructive actions, and the control silently snaps back to
  // its stored value — so the message has to say the setting did not change.
  async function choose(lane: 'localLongitudinal' | 'externalPseudonymous', value: string): Promise<void> {
    if (value !== 'allow' && value !== 'deny') return
    if (busy) return
    laneErrors = { ...laneErrors, [lane]: null }
    actionError = null
    announcement = null
    busy = true
    try {
      const preference = await putAnalyticsPreferences({ [lane]: value })
      if (data !== null) data = { ...data, preference }
      announcement = 'Preference saved.'
    } catch (err) {
      laneErrors = { ...laneErrors, [lane]: `${formatFetchError(err)} The setting was not changed.` }
    } finally {
      busy = false
    }
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
    if (busy) return
    actionError = null
    announcement = null
    busy = true
    try {
      const result = await deleteAnalyticsData()
      confirming = null
      const message = deleteStatusMessage(result.status)
      if (message.tone === 'alert') actionError = message.text
      else announcement = message.text
    } catch (err) {
      actionError = formatFetchError(err)
    } finally {
      busy = false
    }
  }

  // Captured once per mount: the hint's legitimate-interest branch compares against the
  // policy's effective date, which does not move while the section is open.
  const nowMs = Date.now()

  $effect(() => {
    void load()
  })
</script>

<section id="analytics" class="settings-section">
  <PageHeader
    eyebrow="Personal"
    title="Analytics"
    sub="These choices apply to your own account only — never to a group or another member.">
    {#snippet action()}
      <IconButton
        label="Refresh"
        glyph="⟳"
        busy={data === null && loadError === null}
        onClick={() => void load()}
        testid="analytics-refresh" />
    {/snippet}
  </PageHeader>

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
    {#if !data.subjectRightsAvailable}
      <p class="settings-section__caption" data-testid="analytics-rights-unavailable">{RIGHTS_UNAVAILABLE_TEXT}</p>
    {/if}

    <SettingsFieldShell
      label="Local longitudinal analytics"
      editorOpen={false}
      testid="analytics-field-local"
      error={laneErrors.localLongitudinal ?? undefined}
      hint={data.subjectRightsAvailable
        ? laneHint({
            lane: 'localLongitudinal',
            value: data.preference.localLongitudinal,
            effectiveAtMs: data.preference.effectiveAtMs,
            lawfulBasisMode: data.notice.lawfulBasisMode,
            policyEffectiveAtMs: data.notice.policyEffectiveAtMs,
            nowMs,
          })
        : undefined}>
      {#snippet head(describedBy)}
        <SegmentedControl
          options={CHOICE_OPTIONS}
          value={data.preference.localLongitudinal}
          ariaLabel="Local longitudinal analytics"
          ariaDescribedBy={describedBy}
          testidPrefix="analytics-local"
          disabled={busy || !data.subjectRightsAvailable}
          busy={busy}
          onChange={(value) => void choose('localLongitudinal', value)} />
      {/snippet}
    </SettingsFieldShell>

    <SettingsFieldShell
      label="External pseudonymous analytics"
      editorOpen={false}
      testid="analytics-field-external"
      error={laneErrors.externalPseudonymous ?? undefined}
      hint={data.subjectRightsAvailable
        ? laneHint({
            lane: 'externalPseudonymous',
            value: data.preference.externalPseudonymous,
            effectiveAtMs: data.preference.effectiveAtMs,
            lawfulBasisMode: data.notice.lawfulBasisMode,
            policyEffectiveAtMs: data.notice.policyEffectiveAtMs,
            nowMs,
          })
        : undefined}>
      {#snippet head(describedBy)}
        <SegmentedControl
          options={CHOICE_OPTIONS}
          value={data.preference.externalPseudonymous}
          ariaLabel="External pseudonymous analytics"
          ariaDescribedBy={describedBy}
          testidPrefix="analytics-external"
          disabled={busy || !data.subjectRightsAvailable}
          busy={busy}
          onChange={(value) => void choose('externalPseudonymous', value)} />
      {/snippet}
    </SettingsFieldShell>

    <div class="settings-actions">
      <Btn
        variant="outline"
        size="sm"
        disabled={busy || !data.subjectRightsAvailable}
        testid="analytics-export"
        onClick={() => void exportData()}>
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

    <LiveRegion tone="alert" message={actionError} testid="analytics-error" />
    <LiveRegion tone="status" message={announcement} testid="analytics-success" />
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
    color: var(--text-dim);
    line-height: 1.45;
  }
  :global(.settings-section#analytics [data-testid^='analytics-field-']) {
    margin-bottom: var(--gap-inline);
  }
  /* The caption block and the first field are two different things; separate them on the
     section rhythm (--gap-field), not the within-block one (--gap-inline). */
  :global(.settings-section#analytics [data-testid='analytics-field-local']) {
    margin-top: var(--gap-field);
  }
</style>
