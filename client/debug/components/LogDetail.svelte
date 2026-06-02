<script lang="ts">
  import PropertiesTable from '../../shared/PropertiesTable.svelte'
  import SummaryList from '../../shared/ui/SummaryList.svelte'
  import { formatTime, levelName } from '../../shared/helpers.js'
  import type { LogEntry } from '../dashboard-types.js'

  interface Props {
    entry: LogEntry
  }

  let { entry }: Props = $props()

  const STANDARD = new Set(['time', 'level', 'msg', 'scope'])
  const extra = $derived.by(() => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(entry)) {
      if (!STANDARD.has(k)) out[k] = v
    }
    return out
  })

  const hasExtra = $derived(Object.keys(extra).length > 0)
</script>

<div class="log-detail-meta">
  <SummaryList items={[
    { k: 'Time', v: formatTime(entry.time) },
    { k: 'Level', v: levelName(entry.level), pill: true },
    { k: 'Scope', v: entry.scope ?? 'none' },
  ]} />
</div>

<div class="log-detail-section">
  <h4>Message</h4>
  <pre class="log-detail-msg">{entry.msg}</pre>
</div>

{#if hasExtra}
  <div class="log-detail-section">
    <h4>Properties</h4>
    <PropertiesTable obj={extra} />
  </div>
{/if}
