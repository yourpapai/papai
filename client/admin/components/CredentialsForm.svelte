<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { AdminLlmKeyState, AdminLlmSnapshot } from '../../shared/api-types.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import Pill from '../../shared/ui/Pill.svelte'
  import Secret from '../../shared/ui/Secret.svelte'
  import { submitAdminLlm, type SubmitAdminLlmInput } from '../fetchers.js'

  type Key = SubmitAdminLlmInput['key']

  interface Props {
    snapshot: AdminLlmSnapshot | null
    onRefresh: () => Promise<void>
  }

  let { snapshot, onRefresh }: Props = $props()

  const KEYS: readonly Key[] = ['llm_apikey', 'llm_baseurl', 'main_model', 'small_model', 'embedding_model']
  const SENSITIVE_KEYS: ReadonlySet<Key> = new Set(['llm_apikey'])

  let editing: Key | null = $state(null)
  let inputValue: string = $state('')
  let status: { kind: 'error' | 'success'; message: string; forKey: Key } | null = $state(null)
  let submitting = $state(false)

  function startEdit(key: Key): void {
    editing = key
    inputValue = ''
    status = null
  }

  function cancelEdit(): void {
    editing = null
    inputValue = ''
  }

  async function submit(key: Key): Promise<void> {
    if (submitting) return
    submitting = true
    try {
      await submitAdminLlm({ key, value: inputValue })
      status = { kind: 'success', message: 'Updated.', forKey: key }
      editing = null
      inputValue = ''
      await onRefresh()
    } catch (err) {
      status = { kind: 'error', message: err instanceof Error ? err.message : String(err), forKey: key }
    } finally {
      submitting = false
    }
  }

  function display(state: AdminLlmKeyState): string {
    if (state.value === null) return '(not set)'
    return state.value
  }

  function updatedByDisplay(state: AdminLlmKeyState): string {
    if (state.updatedBy === null) return '-'
    return state.updatedBy
  }
</script>

<section class="credentials-form">
  {#if snapshot === null}
    <span class="placeholder">Loading...</span>
  {:else}
    <table>
      <thead>
        <tr><th>Key</th><th>Value</th><th>Updated by</th><th>Action</th></tr>
      </thead>
      <tbody>
        {#each KEYS as key (key)}
          <tr data-testid="credentials-row">
            <td>
              <span class="key-name">{key}</span>
              {#if snapshot[key].required}
                <span data-testid="badge-required-{key}"><Pill tone="neutral">required</Pill></span>
              {:else}
                <span data-testid="badge-optional-{key}"><Pill tone="mute">optional</Pill></span>
              {/if}
            </td>
            <td>
              {#if editing === key}
                <Input
                  type={SENSITIVE_KEYS.has(key) ? 'password' : 'text'}
                  value={inputValue}
                  onInput={(v) => (inputValue = v)}
                  placeholder="new value"
                  testid={`input-${key}`} />
              {:else if SENSITIVE_KEYS.has(key) && snapshot[key].value !== null}
                <span data-testid={`masked-value-${key}`}>
                  <Secret value={snapshot[key].value ?? '••••••••'} hint="(hidden)" />
                </span>
              {:else}
                <span>{display(snapshot[key])}</span>
              {/if}
            </td>
            <td>{updatedByDisplay(snapshot[key])}</td>
            <td>
              {#if editing === key}
                <Btn
                  variant="primary"
                  size="sm"
                  type="button"
                  testid={`submit-${key}`}
                  disabled={submitting || inputValue.trim() === ''}
                  onClick={() => {
                    void submit(key)
                  }}>
                  {#snippet children()}Save{/snippet}
                </Btn>
                <Btn variant="ghost" size="sm" onClick={cancelEdit}>
                  {#snippet children()}Cancel{/snippet}
                </Btn>
              {:else}
                <Btn variant="secondary" size="sm" testid={`edit-${key}`} onClick={() => startEdit(key)}>
                  {#snippet children()}Edit{/snippet}
                </Btn>
              {/if}
              {#if status !== null && status.forKey === key}
                <span class={status.kind === 'error' ? 'status-error' : 'status-success'}>
                  {status.message}
                </span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .key-name {
    margin-right: 6px;
  }
</style>
