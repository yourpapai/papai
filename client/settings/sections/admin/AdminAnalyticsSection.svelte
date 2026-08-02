<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../../shared/ui/Btn.svelte'
  import Checkbox from '../../../shared/ui/Checkbox.svelte'
  import ErrorState from '../../../shared/ui/ErrorState.svelte'
  import Field from '../../../shared/ui/Field.svelte'
  import Input from '../../../shared/ui/Input.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import Select from '../../../shared/ui/Select.svelte'
  import {
    createAnalyticsSink,
    disableAnalyticsSink,
    fetchAdminAnalytics,
    patchAdminAnalytics,
    reconcileAnalytics,
    rotateAnalyticsSink,
    verifyAnalyticsSink,
  } from '../../analytics-fetchers.js'
  import type { SinkGateAttestation } from '../../analytics-fetchers.js'
  import type {
    AdminAnalyticsResponse,
    AnalyticsReconcileResponse,
    AnalyticsSinkView,
  } from '../../fetcher-schemas-analytics.js'

  const MODE_OPTIONS = [
    { value: 'off', label: 'Off' },
    { value: 'local_aggregate', label: 'Local aggregate' },
    { value: 'local_pseudonymous', label: 'Local pseudonymous' },
  ]

  const KIND_OPTIONS = [
    { value: 'webhook', label: 'Webhook' },
    { value: 'openpanel', label: 'OpenPanel' },
  ]

  const EGRESS_OPTIONS = [
    { value: 'aggregate', label: 'Aggregate' },
    { value: 'pseudonymous', label: 'Pseudonymous' },
  ]

  let data = $state<AdminAnalyticsResponse | null>(null)
  let loadError: string | null = $state(null)
  let actionError: string | null = $state(null)
  let announcement: string | null = $state(null)
  let busy = $state(false)
  let reconcileReport = $state<AnalyticsReconcileResponse | null>(null)

  let localMode = $state('local_aggregate')
  let externalAggregate = $state(false)
  let externalPseudonymous = $state(false)
  let retentionDays = $state('')

  let sinkLogicalId = $state('')
  let sinkKind = $state('webhook')
  let sinkEgress = $state('aggregate')
  let sinkEndpoint = $state('')
  let sinkSecret = $state('')
  let rotateEndpoint = $state('')
  let rotateSecret = $state('')

  const gate = $state({
    callerControlledIdempotency: true,
    deterministicReconciliation: true,
    deleteActor: true,
    subprocessorReviewed: true,
    residencyReviewed: true,
    deletionPathReviewed: true,
    incidentReviewed: true,
    transferReviewed: true,
    noSecondaryUse: true,
    httpsPolicyApproved: true,
  })

  const gateAttestation = (): SinkGateAttestation => ({
    capabilities: {
      callerControlledIdempotency: gate.callerControlledIdempotency,
      deterministicReconciliation: gate.deterministicReconciliation,
      deleteActor: gate.deleteActor,
    },
    processorReview: {
      subprocessorReviewed: gate.subprocessorReviewed,
      residencyReviewed: gate.residencyReviewed,
      deletionPathReviewed: gate.deletionPathReviewed,
      incidentReviewed: gate.incidentReviewed,
      transferReviewed: gate.transferReviewed,
      noSecondaryUse: gate.noSecondaryUse,
    },
    httpsPolicyApproved: gate.httpsPolicyApproved,
  })

  function messageFrom(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  function applyData(next: AdminAnalyticsResponse): void {
    data = next
    localMode = next.mode.localMode
    externalAggregate = next.mode.externalAggregateEnabled
    externalPseudonymous = next.mode.externalPseudonymousEnabled
    retentionDays = next.policy.retainedEventHorizonDays?.toString() ?? ''
  }

  async function load(): Promise<void> {
    loadError = null
    actionError = null
    try {
      applyData(await fetchAdminAnalytics())
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

  async function save(): Promise<void> {
    if (data === null) return
    const retention = retentionDays.trim() === '' ? undefined : Number(retentionDays)
    await run(async () => {
      applyData(
        await patchAdminAnalytics({
          expectedConfigVersion: data!.configVersion,
          localMode: localMode as 'off' | 'local_aggregate' | 'local_pseudonymous',
          externalAggregateEnabled: externalAggregate,
          externalPseudonymousEnabled: externalPseudonymous,
          retainedEventHorizonDays: retention,
        }),
      )
      return 'Analytics settings saved.'
    })
  }

  async function acknowledgeReview(): Promise<void> {
    if (data === null) return
    await run(async () => {
      applyData(await patchAdminAnalytics({ expectedConfigVersion: data!.configVersion, acknowledge: true }))
      return 'Review acknowledged.'
    })
  }

  async function createSink(): Promise<void> {
    await run(async () => {
      await createAnalyticsSink({
        logicalSinkId: sinkLogicalId,
        kind: sinkKind as 'webhook' | 'openpanel',
        egressMode: sinkEgress as 'aggregate' | 'pseudonymous',
        endpoint: sinkEndpoint,
        secret: sinkSecret,
      })
      sinkEndpoint = ''
      sinkSecret = ''
      sinkLogicalId = ''
      await load()
      return 'Sink version created (pending verification).'
    })
  }

  async function verifySink(sink: AnalyticsSinkView): Promise<void> {
    await run(async () => {
      const result = await verifyAnalyticsSink(sink.sinkVersionId, gateAttestation())
      await load()
      if (result.status === 'enabled') return `Sink ${sink.logicalSinkId}:v${sink.version} enabled.`
      return `Verification ${result.status}: ${result.reason ?? result.failureClass ?? ''}`
    })
  }

  async function rotateSink(sink: AnalyticsSinkView): Promise<void> {
    await run(async () => {
      const result = await rotateAnalyticsSink(sink.sinkVersionId, {
        kind: sink.kind as 'webhook' | 'openpanel',
        egressMode: sink.egressMode as 'aggregate' | 'pseudonymous',
        endpoint: rotateEndpoint,
        secret: rotateSecret,
        ...gateAttestation(),
      })
      rotateEndpoint = ''
      rotateSecret = ''
      await load()
      if (result.status === 'rotated') return `Sink ${sink.logicalSinkId} rotated.`
      return `Rotation ${result.status}: ${result.reason ?? result.failureClass ?? ''}`
    })
  }

  async function disableSink(sink: AnalyticsSinkView): Promise<void> {
    await run(async () => {
      await disableAnalyticsSink(sink.sinkVersionId)
      await load()
      return `Sink ${sink.logicalSinkId}:v${sink.version} disabled.`
    })
  }

  async function reconcile(): Promise<void> {
    await run(async () => {
      reconcileReport = await reconcileAnalytics({ apply: true })
      return `Reconciliation: ${reconcileReport.status}.`
    })
  }

  $effect(() => {
    void load()
  })
</script>

<section id="analytics-admin" class="settings-section">
  <PageHeader eyebrow="Admin" title="Analytics" />

  {#if loadError !== null && data === null}
    <ErrorState title="Couldn't load analytics settings" message={loadError} onRetry={() => void load()} />
  {:else if data === null}
    <p class="placeholder" data-testid="analytics-admin-loading">Loading…</p>
  {:else}
    {#if data.effective.killSwitchActive}
      <p class="status-error" data-testid="analytics-admin-killswitch">
        Kill switch is ON (read-only, environment-controlled) and is authoritative over the stored settings below:
        all collection and egress are off until it is lifted.
      </p>
    {/if}

    <Field label="Collection mode">
      <Select value={localMode} options={MODE_OPTIONS} testid="analytics-admin-mode" onChange={(v) => (localMode = v)} />
    </Field>
    <Checkbox
      checked={externalAggregate}
      label="External aggregate egress"
      testid="analytics-admin-ext-agg"
      onChange={(v) => (externalAggregate = v)} />
    <Checkbox
      checked={externalPseudonymous}
      label="External pseudonymous egress"
      testid="analytics-admin-ext-pseudo"
      onChange={(v) => (externalPseudonymous = v)} />

    <Field label="Retained event horizon (days)" hint="Downward-only: retention can only be shortened.">
      <Input value={retentionDays} testid="analytics-admin-retention" onInput={(v) => (retentionDays = v)} />
    </Field>
    <p class="settings-section__caption" data-testid="analytics-admin-horizon">
      Subject-rights lookup horizon: {data.policy.subjectRightsLookupHorizonDays} days (read-only policy evidence;
      changing it requires a new reviewed schema/policy version).
    </p>

    <div class="settings-actions">
      <Btn variant="primary" size="sm" {busy} disabled={busy} testid="analytics-admin-save" onClick={() => void save()}>
        {#snippet children()}Save{/snippet}
      </Btn>
      <Btn
        variant="outline"
        size="sm"
        disabled={busy || data.policy.acknowledgedAtMs !== null}
        testid="analytics-admin-acknowledge"
        onClick={() => void acknowledgeReview()}>
        {#snippet children()}{data.policy.acknowledgedAtMs === null ? 'Acknowledge review' : 'Review acknowledged'}{/snippet}
      </Btn>
    </div>

    <div data-testid="analytics-admin-readiness">
      {#if data.readiness.ready}
        <p class="status-success">Governance readiness: ready.</p>
      {:else}
        <p class="settings-section__caption">Governance readiness is incomplete:</p>
        <ul>
          {#each data.readiness.missing as item (item)}
            <li>{item}</li>
          {/each}
        </ul>
      {/if}
    </div>

    <p class="settings-section__caption" data-testid="analytics-admin-openpanel">
      OpenPanel pseudonymous egress is blocked: {data.openPanel.reasons.join(', ')}.
    </p>
    <p class="settings-section__caption" data-testid="analytics-admin-snapshot">
      {#if data.snapshot === null}
        No published snapshot.
      {:else}
        Snapshot {data.snapshot.snapshotId} · age {data.snapshot.ageMs} ms
      {/if}
    </p>

    <h3>Sinks</h3>
    {#each data.sinks as sink (sink.sinkVersionId)}
      <div class="sink-row" data-testid="sink-row-{sink.sinkVersionId}">
        <span>
          {sink.logicalSinkId} v{sink.version} · {sink.kind} · {sink.egressMode} · {sink.state} · fingerprint
          {sink.configFingerprint}
        </span>
        {#if sink.state === 'pending_verification'}
          <Btn variant="outline" size="sm" disabled={busy} testid="sink-verify-{sink.sinkVersionId}" onClick={() => void verifySink(sink)}>
            {#snippet children()}Verify{/snippet}
          </Btn>
        {/if}
        {#if sink.state === 'enabled'}
          <Btn variant="outline" size="sm" disabled={busy} testid="sink-disable-{sink.sinkVersionId}" onClick={() => void disableSink(sink)}>
            {#snippet children()}Disable{/snippet}
          </Btn>
        {/if}
      </div>
      {#if sink.state === 'enabled'}
        <div class="sink-rotate">
          <Field label="Rotate endpoint">
            <Input value={rotateEndpoint} testid="sink-rotate-endpoint" onInput={(v) => (rotateEndpoint = v)} />
          </Field>
          <Field label="Rotate secret">
            <Input value={rotateSecret} type="password" testid="sink-rotate-secret" onInput={(v) => (rotateSecret = v)} />
          </Field>
          <Btn
            variant="outline"
            size="sm"
            disabled={busy || rotateEndpoint === '' || rotateSecret === ''}
            testid="sink-rotate-{sink.sinkVersionId}"
            onClick={() => void rotateSink(sink)}>
            {#snippet children()}Rotate{/snippet}
          </Btn>
        </div>
      {/if}
    {/each}

    <h3>Create sink version</h3>
    <Field label="Logical sink ID">
      <Input value={sinkLogicalId} testid="sink-logical-id" onInput={(v) => (sinkLogicalId = v)} />
    </Field>
    <Field label="Kind">
      <Select value={sinkKind} options={KIND_OPTIONS} testid="sink-kind" onChange={(v) => (sinkKind = v)} />
    </Field>
    <Field label="Egress mode">
      <Select value={sinkEgress} options={EGRESS_OPTIONS} testid="sink-egress" onChange={(v) => (sinkEgress = v)} />
    </Field>
    <Field label="Endpoint (HTTPS, write-only)">
      <Input value={sinkEndpoint} testid="sink-endpoint" onInput={(v) => (sinkEndpoint = v)} />
    </Field>
    <Field label="Secret (write-only, never shown again)">
      <Input value={sinkSecret} type="password" testid="sink-secret" onInput={(v) => (sinkSecret = v)} />
    </Field>
    <Btn
      variant="outline"
      size="sm"
      disabled={busy || sinkLogicalId === '' || sinkEndpoint === '' || sinkSecret === ''}
      testid="sink-create"
      onClick={() => void createSink()}>
      {#snippet children()}Create sink version{/snippet}
    </Btn>

    <fieldset class="gate">
      <legend>Sink gate attestation</legend>
      <Checkbox checked={gate.callerControlledIdempotency} label="Caller-controlled idempotency" testid="gate-idempotency" onChange={(v) => (gate.callerControlledIdempotency = v)} />
      <Checkbox checked={gate.deterministicReconciliation} label="Deterministic reconciliation" testid="gate-reconciliation" onChange={(v) => (gate.deterministicReconciliation = v)} />
      <Checkbox checked={gate.deleteActor} label="Per-actor delete" testid="gate-delete-actor" onChange={(v) => (gate.deleteActor = v)} />
      <Checkbox checked={gate.subprocessorReviewed} label="Subprocessor reviewed" testid="gate-subprocessor" onChange={(v) => (gate.subprocessorReviewed = v)} />
      <Checkbox checked={gate.residencyReviewed} label="Residency reviewed" testid="gate-residency" onChange={(v) => (gate.residencyReviewed = v)} />
      <Checkbox checked={gate.deletionPathReviewed} label="Deletion path reviewed" testid="gate-deletion-path" onChange={(v) => (gate.deletionPathReviewed = v)} />
      <Checkbox checked={gate.incidentReviewed} label="Incident reviewed" testid="gate-incident" onChange={(v) => (gate.incidentReviewed = v)} />
      <Checkbox checked={gate.transferReviewed} label="Transfer reviewed" testid="gate-transfer" onChange={(v) => (gate.transferReviewed = v)} />
      <Checkbox checked={gate.noSecondaryUse} label="No secondary use" testid="gate-no-secondary" onChange={(v) => (gate.noSecondaryUse = v)} />
      <Checkbox checked={gate.httpsPolicyApproved} label="HTTPS policy approved" testid="gate-https" onChange={(v) => (gate.httpsPolicyApproved = v)} />
    </fieldset>

    <div class="settings-actions">
      <Btn variant="outline" size="sm" disabled={busy} testid="analytics-admin-reconcile" onClick={() => void reconcile()}>
        {#snippet children()}Run reconciliation{/snippet}
      </Btn>
    </div>
    {#if reconcileReport !== null}
      <p class="settings-section__caption" data-testid="analytics-admin-reconcile-result">
        Status: {reconcileReport.status} · deliveries {reconcileReport.delivery.total} · conserved
        {reconcileReport.delivery.conserved} · association violations {reconcileReport.associationViolations}
      </p>
    {/if}

    {#if actionError !== null}
      <p class="status-error" role="alert" data-testid="analytics-admin-error">{actionError}</p>
    {/if}
    {#if announcement !== null}
      <p class="status-success" role="status" data-testid="analytics-admin-success">{announcement}</p>
    {/if}
  {/if}
</section>

<style>
  .settings-section__caption {
    margin: var(--gap-inline) 0;
    font-size: 12px;
    color: var(--text-dim);
    line-height: 1.45;
  }
  .sink-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    margin: 4px 0;
  }
  .gate {
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    margin: var(--gap-inline) 0;
    padding: 8px;
    font-size: 12px;
  }
</style>
