<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Confirm from '../../shared/Confirm.svelte'
  import Btn from '../../shared/ui/Btn.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import LiveRegion from '../../shared/ui/LiveRegion.svelte'
  import { formatFetchError } from '../../shared/format-error.js'
  import type { VaultTokenRecord } from '../fetcher-schemas-context-vault.js'
  import { createVaultToken, fetchVaultTokens, revokeVaultToken } from '../context-vault-fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let tokens: VaultTokenRecord[] = $state([])
  let listError: string | null = $state(null)
  let listStatus: string | null = $state(null)
  let createError: string | null = $state(null)
  let loading = $state(false)
  let creating = $state(false)
  let revokingId: string | null = $state(null)
  let pendingRevokeId: string | null = $state(null)
  let createdPlaintext: string | null = $state(null)

  let createLabel = $state('')

  async function load(id: string): Promise<void> {
    listError = null
    loading = true
    try {
      const data = await fetchVaultTokens(id)
      if (id !== contextId) return
      tokens = data.tokens
    } catch (err) {
      if (id === contextId) listError = formatFetchError(err)
    } finally {
      if (id === contextId) loading = false
    }
  }

  async function handleCreate(): Promise<void> {
    createError = null
    creating = true
    try {
      const created = await createVaultToken({ contextId, label: createLabel.trim() })
      createLabel = ''
      createdPlaintext = created.plaintext
      await load(contextId)
      listStatus = null
    } catch (err) {
      createError = formatFetchError(err)
    } finally {
      creating = false
    }
  }

  async function handleRevoke(tokenId: string): Promise<void> {
    listError = null
    listStatus = null
    revokingId = tokenId
    try {
      await revokeVaultToken({ contextId, tokenId })
      await load(contextId)
      listStatus = 'Token revoked.'
    } catch (err) {
      listError = formatFetchError(err)
    } finally {
      revokingId = null
      pendingRevokeId = null
    }
  }

  const formatEpoch = (epoch: number): string => new Date(epoch).toISOString().slice(0, 10)

  $effect(() => {
    createdPlaintext = null
    createError = null
    listStatus = null
    void load(contextId)
  })
</script>

<section id="context-vault" class="settings-section">
  <PageHeader eyebrow="Coding sessions" title="Context Vault tokens">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="vault-refresh" />
    {/snippet}
  </PageHeader>

  <div class="settings-vault__feedback">
    <LiveRegion tone="alert" message={listError} />
    {#if listError !== null}
      <Btn variant="outline" size="sm" testid="vault-error-retry" onClick={() => void load(contextId)}>
        {#snippet children()}Retry{/snippet}
      </Btn>
    {/if}
  </div>
  <LiveRegion tone="status" message={listStatus} />

  {#if loading && tokens.length === 0}
    <p class="placeholder">Loading…</p>
  {:else}
    <div class="settings-vault">
      {#each tokens as token (token.tokenId)}
        <div class="settings-vault__row" data-testid={`vault-token-row-${token.tokenId}`}>
          <div class="settings-vault__info">
            <span class="settings-vault__label">{token.label}</span>
            <span class="settings-vault__meta"
              >token •••••• · created {formatEpoch(token.createdAt)}{token.lastUsedAt !== null
                ? ` · last push ${formatEpoch(token.lastUsedAt)}`
                : ' · never used'}{token.revokedAt !== null ? ` · revoked ${formatEpoch(token.revokedAt)}` : ''}</span>
          </div>
          {#if token.revokedAt === null}
            <Btn
              variant="danger"
              size="sm"
              testid={`vault-revoke-${token.tokenId}`}
              disabled={revokingId === token.tokenId}
              onClick={() => (pendingRevokeId = token.tokenId)}>
              {#snippet children()}{revokingId === token.tokenId ? 'Revoking…' : 'Revoke'}{/snippet}
            </Btn>
          {:else}
            <span class="settings-vault__revoked" data-testid={`vault-revoked-${token.tokenId}`}>Revoked</span>
          {/if}
        </div>
      {:else}
        <EmptyState
          title="No vault tokens"
          hint="Create one below so a context-vault indexer can push spec summaries for this context." />
      {/each}
    </div>

    <div class="settings-vault__create">
      <div class="settings-vault__create-head">
        <h3 class="settings-vault__create-label">Create token</h3>
        <p class="settings-vault__create-note">
          The token value is shown only once, right after creation — store it in the indexer's configuration.
        </p>
      </div>
      <div class="settings-form">
        <Field label="Label" required>
          <Input
            value={createLabel}
            onInput={(v) => (createLabel = v)}
            placeholder="workstation indexer"
            testid="vault-create-label" />
        </Field>
      </div>
      <div class="settings-vault__actions">
        <Btn
          variant="primary"
          testid="vault-create-submit"
          disabled={creating || createLabel.trim().length === 0}
          onClick={() => void handleCreate()}>
          {#snippet children()}{creating ? 'Creating…' : 'Create'}{/snippet}
        </Btn>
      </div>
      <LiveRegion tone="alert" message={createError} />
      {#if createdPlaintext !== null}
        <div class="settings-vault__created" data-testid="vault-created-plaintext">
          <p class="settings-vault__created-note">This token is shown only once. Copy it now.</p>
          <code class="settings-vault__created-value">{createdPlaintext}</code>
          <Btn variant="outline" size="sm" testid="vault-created-dismiss" onClick={() => (createdPlaintext = null)}>
            {#snippet children()}Dismiss{/snippet}
          </Btn>
        </div>
      {/if}
    </div>
  {/if}

  <Confirm
    open={pendingRevokeId !== null}
    title="Revoke token"
    danger
    busy={revokingId !== null}
    confirmLabel="Revoke"
    onCancel={() => {
      pendingRevokeId = null
    }}
    onConfirm={() => {
      if (pendingRevokeId !== null) void handleRevoke(pendingRevokeId)
    }}>
    {#snippet body()}
      <p>
        Revoke {tokens.find((t) => t.tokenId === pendingRevokeId)?.label ?? 'this token'}? Indexers using it will no
        longer be able to push.
      </p>
    {/snippet}
  </Confirm>
</section>

<style>
  .settings-vault {
    display: grid;
    gap: var(--gap-tight);
    margin-bottom: var(--gap-field);
  }
  .settings-vault__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-inline);
    padding: var(--gap-tight) var(--gap-inline);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface-1);
  }
  .settings-vault__info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .settings-vault__label {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text);
    font-weight: 600;
  }
  .settings-vault__meta {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-dim);
  }
  .settings-vault__revoked {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-dim);
  }
  .settings-vault__feedback {
    display: flex;
    align-items: center;
    gap: var(--s2);
  }
  .settings-vault__feedback .status-error {
    margin: 0;
  }
  .settings-vault__create {
    display: grid;
    gap: var(--gap-inline);
    padding: var(--gap-inline);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface-1);
  }
  .settings-vault__create-head {
    display: grid;
    gap: var(--s1);
  }
  .settings-vault__create-label {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 400;
    color: var(--text-dim);
    margin: 0;
  }
  .settings-vault__create-note {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-dim);
    margin: 0;
  }
  #context-vault .settings-form {
    margin-bottom: 0;
  }
  .settings-vault__actions {
    display: flex;
    justify-content: flex-end;
  }
  .settings-vault__created {
    display: grid;
    gap: var(--s2);
    padding: var(--gap-inline);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface-2, var(--surface-1));
  }
  .settings-vault__created-note {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-dim);
    margin: 0;
  }
  .settings-vault__created-value {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text);
    word-break: break-all;
  }
</style>
