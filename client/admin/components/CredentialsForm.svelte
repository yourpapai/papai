<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { AdminLlmKeyState, AdminLlmSnapshot } from '../../shared/api-types.js'
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
  <h3>LLM credentials</h3>
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
            <td>{key}</td>
            <td>
              {#if editing === key}
                <input
                  type="text"
                  data-testid={`input-${key}`}
                  bind:value={inputValue}
                  placeholder="new value" />
              {:else if SENSITIVE_KEYS.has(key) && snapshot[key].value !== null}
                <code class="masked-value" data-testid={`masked-value-${key}`}>{snapshot[key].value}</code>
                <span class="masked-hint">(hidden)</span>
              {:else}
                <span>{display(snapshot[key])}</span>
              {/if}
            </td>
            <td>{updatedByDisplay(snapshot[key])}</td>
            <td>
              {#if editing === key}
                <button
                  type="button"
                  data-testid={`submit-${key}`}
                  disabled={submitting || inputValue.trim() === ''}
                  onclick={() => {
                    void submit(key)
                  }}>Save</button>
                <button type="button" onclick={cancelEdit}>Cancel</button>
              {:else}
                <button
                  type="button"
                  data-testid={`edit-${key}`}
                  onclick={() => startEdit(key)}>Edit</button>
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
