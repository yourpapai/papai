<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { AdminPluginConfigKeyState, AdminPluginConfigSnapshot } from '../../shared/api-types.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import Panel from '../../shared/ui/Panel.svelte'
  import Secret from '../../shared/ui/Secret.svelte'
  import { submitAdminPluginConfig } from '../plugin-config-fetchers.js'

  interface Props {
    snapshot: AdminPluginConfigSnapshot | null
    onRefresh: () => Promise<void>
  }

  let { snapshot, onRefresh }: Props = $props()

  type EditingKey = { pluginId: string; key: string }

  let editing: EditingKey | null = $state(null)
  let inputValue: string = $state('')
  let status: { kind: 'error' | 'success'; message: string; pluginId: string; key: string } | null = $state(null)
  let submitting = $state(false)

  function startEdit(pluginId: string, key: string): void {
    editing = { pluginId, key }
    inputValue = ''
    status = null
  }

  function cancelEdit(): void {
    editing = null
    inputValue = ''
  }

  async function submit(pluginId: string, key: string): Promise<void> {
    if (submitting) return
    submitting = true
    try {
      await submitAdminPluginConfig({ pluginId, key, value: inputValue })
      status = { kind: 'success', message: 'Updated.', pluginId, key }
      editing = null
      inputValue = ''
      await onRefresh()
    } catch (err) {
      status = { kind: 'error', message: err instanceof Error ? err.message : String(err), pluginId, key }
    } finally {
      submitting = false
    }
  }

  function display(state: AdminPluginConfigKeyState): string {
    if (state.value === null) return '(not set)'
    return state.value
  }

  function isEditing(pluginId: string, key: string): boolean {
    return editing !== null && editing.pluginId === pluginId && editing.key === key
  }
</script>

<section class="plugin-config-form">
  {#if snapshot === null}
    <span class="placeholder">Loading...</span>
  {:else if snapshot.plugins.length === 0}
    <p class="empty-state">No plugins with configuration found.</p>
  {:else}
    {#each snapshot.plugins as plugin (plugin.pluginId)}
      <Panel title={plugin.pluginId}>
        {#snippet body()}
          <table>
            <thead>
              <tr><th>Key</th><th>Value</th><th>Action</th></tr>
            </thead>
            <tbody>
              {#each plugin.keys as keyState (keyState.key)}
                <tr data-testid="plugin-config-row">
                  <td>
                    <span>{keyState.label}</span>
                    {#if keyState.required}
                      <span class="required-badge">required</span>
                    {/if}
                  </td>
                  <td>
                    {#if isEditing(plugin.pluginId, keyState.key)}
                      <Input
                        type={keyState.sensitive ? 'password' : 'text'}
                        value={inputValue}
                        onInput={(v) => (inputValue = v)}
                        placeholder="new value"
                        testid={`input-${plugin.pluginId}-${keyState.key}`} />
                    {:else if keyState.sensitive && keyState.value !== null}
                      <span data-testid={`masked-value-${plugin.pluginId}-${keyState.key}`}>
                        <Secret value={keyState.value} hint="(hidden)" />
                      </span>
                    {:else}
                      <span>{display(keyState)}</span>
                    {/if}
                  </td>
                  <td>
                    {#if isEditing(plugin.pluginId, keyState.key)}
                      <Btn
                        variant="primary"
                        size="sm"
                        type="button"
                        testid={`submit-${plugin.pluginId}-${keyState.key}`}
                        disabled={submitting || inputValue.trim() === ''}
                        onClick={() => {
                          void submit(plugin.pluginId, keyState.key)
                        }}>
                        {#snippet children()}Save{/snippet}
                      </Btn>
                      <Btn variant="ghost" size="sm" onClick={cancelEdit}>
                        {#snippet children()}Cancel{/snippet}
                      </Btn>
                    {:else}
                      <Btn
                        variant="secondary"
                        size="sm"
                        testid={`edit-${plugin.pluginId}-${keyState.key}`}
                        onClick={() => startEdit(plugin.pluginId, keyState.key)}>
                        {#snippet children()}Edit{/snippet}
                      </Btn>
                    {/if}
                    {#if status !== null && status.pluginId === plugin.pluginId && status.key === keyState.key}
                      <span class={status.kind === 'error' ? 'status-error' : 'status-success'}>
                        {status.message}
                      </span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/snippet}
      </Panel>
    {/each}
  {/if}
</section>

<style>
  .required-badge {
    display: inline-block;
    margin-inline-start: 6px;
    padding: 1px 5px;
    font-size: 10px;
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 3px;
  }

  .empty-state {
    color: var(--fg3);
    font-size: 13px;
    margin: 8px 0;
  }
</style>
