<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Code from './Code.svelte'

  interface Props {
    value: string | Record<string, unknown>
  }

  let { value }: Props = $props()

  function isRecordObject(x: unknown): x is Record<string, unknown> {
    return x !== null && typeof x === 'object' && !Array.isArray(x)
  }

  function safeParse(s: string): Record<string, unknown> | null {
    try {
      const parsed: unknown = JSON.parse(s)
      return isRecordObject(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  const obj = $derived(typeof value === 'string' ? safeParse(value) : value)
  const entries = $derived(isRecordObject(obj) ? Object.entries(obj) : null)
</script>

{#if entries}
  <div class="ui-jsoncell">
    {#each entries as [k, v] (k)}
      <span class="ui-jsoncell__chip">
        <span class="ui-jsoncell__key">{k}</span>
        <span class="ui-jsoncell__val">{String(v)}</span>
      </span>
    {/each}
  </div>
{:else}
  <Code>{String(value)}</Code>
{/if}

<style>
  .ui-jsoncell {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ui-jsoncell__chip {
    font-family: var(--font-mono);
    font-size: 11px;
    display: inline-flex;
    border: 1px solid var(--hair);
    border-radius: 2px;
    overflow: hidden;
  }
  .ui-jsoncell__key {
    background: var(--inset);
    color: var(--fg3);
    padding: 2px 7px;
  }
  .ui-jsoncell__val {
    background: var(--raised);
    color: var(--fg);
    padding: 2px 7px;
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
