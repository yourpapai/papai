<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { AdminPluginConfigKeyState, AdminPluginConfigSnapshot } from '../../shared/api-types.js'
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
  <h3>Plugin configuration</h3>
  {#if snapshot === null}
    <span class="placeholder">Loading...</span>
  {:else if snapshot.plugins.length === 0}
    <p class="empty-state">No plugins with configuration found.</p>
  {:else}
    {#each snapshot.plugins as plugin (plugin.pluginId)}
      <section class="plugin-group" aria-label={`Plugin ${plugin.pluginId}`}>
        <h4>{plugin.pluginId}</h4>
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
                    <input
                      type={keyState.sensitive ? 'password' : 'text'}
                      data-testid={`input-${plugin.pluginId}-${keyState.key}`}
                      bind:value={inputValue}
                      placeholder="new value" />
                  {:else if keyState.sensitive && keyState.value !== null}
                    <code class="masked-value" data-testid={`masked-value-${plugin.pluginId}-${keyState.key}`}>••••••••</code>
                    <span class="masked-hint">(hidden)</span>
                  {:else}
                    <span>{display(keyState)}</span>
                  {/if}
                </td>
                <td>
                  {#if isEditing(plugin.pluginId, keyState.key)}
                    <button
                      type="button"
                      data-testid={`submit-${plugin.pluginId}-${keyState.key}`}
                      disabled={submitting || inputValue.trim() === ''}
                      onclick={() => {
                        void submit(plugin.pluginId, keyState.key)
                      }}>Save</button>
                    <button type="button" onclick={cancelEdit}>Cancel</button>
                  {:else}
                    <button
                      type="button"
                      data-testid={`edit-${plugin.pluginId}-${keyState.key}`}
                      onclick={() => startEdit(plugin.pluginId, keyState.key)}>Edit</button>
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
      </section>
    {/each}
  {/if}
</section>

<style>
  .plugin-group {
    margin-block-start: 16px;
  }

  .plugin-group h4 {
    margin: 0 0 8px;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--fg2);
  }

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
