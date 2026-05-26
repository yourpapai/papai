<script lang="ts">
  import Self from './TreeView.svelte'

  interface Props {
    value: unknown
    label?: string
    depth?: number
  }

  let { value, label = undefined, depth = 0 }: Props = $props()

  const MAX_DEPTH = 50

  function getValueType(v: unknown): string {
    if (v === null) return 'null'
    if (v === undefined) return 'undefined'
    if (Array.isArray(v)) return 'array'
    return typeof v
  }

  function formatPrimitive(v: unknown): string {
    if (v === null) return 'null'
    if (v === undefined) return 'undefined'
    if (typeof v === 'string') return `"${v}"`
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    return JSON.stringify(v)
  }

  const type = $derived(getValueType(value))
  const isContainer = $derived(type === 'array' || type === 'object')
  const entries = $derived.by(() => {
    if (type === 'array' && Array.isArray(value)) {
      return value.map((v: unknown, i): [string, unknown] => [String(i), v])
    }
    if (type === 'object' && typeof value === 'object' && value !== null) {
      return Object.entries(value as Record<string, unknown>)
    }
    return [] as Array<[string, unknown]>
  })
  const bracketOpen = $derived(type === 'array' ? '[' : '{')
  const bracketClose = $derived(type === 'array' ? ']' : '}')

  let collapsed = $state(depth >= 2)
</script>

{#if depth >= MAX_DEPTH}
  {#if label !== undefined}<span class="tree-key">{label}: </span>{/if}
  <span class="tree-bracket">...</span>
{:else}
{#if isContainer}
  {#if label !== undefined}<span class="tree-key">{label}: </span>{/if}
  {#if entries.length === 0}
    <span class="tree-bracket">{bracketOpen}{bracketClose}</span>
  {:else}
    <span
      class="tree-toggle"
      class:collapsed
      role="button"
      tabindex="0"
      onclick={() => (collapsed = !collapsed)}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          collapsed = !collapsed
        }
      }}>{collapsed ? '▶' : '▼'}</span>
    <span class="tree-bracket">{bracketOpen}</span>
    {#if !collapsed}
      {#if depth >= MAX_DEPTH}
        <span class="tree-bracket"> ... </span>
      {:else}
        <span class="tree-children">
          {#each entries as [k, v] (k)}
            <div class="tree-row" style="padding-left: {(depth + 1) * 12}px">
              <Self value={v} label={k} depth={depth + 1} />
            </div>
          {/each}
        </span>
      {/if}
    {/if}
    <span class="tree-bracket">{bracketClose}</span>
  {/if}
{:else}
  {#if label !== undefined}<span class="tree-key">{label}: </span>{/if}
  <span class="tree-{type}">{formatPrimitive(value)}</span>
{/if}
{/if}

<style>
  .tree-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 2px 0;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg);
    line-height: 1.5;
  }
  .tree-key {
    color: var(--fg2);
  }
  .tree-toggle {
    display: inline-flex;
    width: 12px;
    color: var(--fg3);
    cursor: pointer;
    user-select: none;
  }
  .tree-bracket {
    color: var(--fg3);
  }
  .tree-children {
    border-left: 1px dashed var(--hair);
  }
  .tree-string {
    color: var(--accent);
  }
  .tree-number {
    color: var(--info);
  }
  .tree-boolean {
    color: var(--warn);
  }
  .tree-null {
    color: var(--fg4);
    font-style: italic;
  }
</style>
