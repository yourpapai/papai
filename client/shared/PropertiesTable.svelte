<script lang="ts">
  import TreeView from './TreeView.svelte'

  interface Props {
    obj: Record<string, unknown>
  }

  let { obj }: Props = $props()

  function isContainer(v: unknown): boolean {
    return v !== null && (Array.isArray(v) || typeof v === 'object')
  }

  const entries = $derived(Object.entries(obj))
</script>

{#if entries.length === 0}
  <p class="tree-empty">No properties</p>
{:else}
  <div class="tree-container">
    <table class="tree-table">
      <tbody>
        {#each entries as [key, value] (key)}
          <tr>
            <td class="tree-key-cell">{key}</td>
            <td class="tree-value-cell">
              {#if isContainer(value)}
                <TreeView {value} />
              {:else}
                <TreeView {value} />
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
