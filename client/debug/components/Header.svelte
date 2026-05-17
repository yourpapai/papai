<script lang="ts">
  import { formatUptime } from '../helpers.js'
  import type { DashboardState } from '../dashboard-types.js'

  interface Props {
    dashboard: DashboardState
  }

  let { dashboard }: Props = $props()

  let uptimeTick = $state(0)
  $effect(() => {
    const id = setInterval(() => {
      uptimeTick += 1
    }, 10000)
    return () => clearInterval(id)
  })

  const uptime = $derived.by(() => {
    void uptimeTick
    return formatUptime(dashboard.stats.startedAt)
  })

  const schedulerLabel = $derived.by(() => {
    const sched = dashboard.scheduler
    const running = sched.running ?? false
    const tickPart = sched.tickCount === undefined ? '' : ` (tick #${sched.tickCount})`
    return `scheduler: ${running ? 'running' : 'stopped'}${tickPart}`
  })

  const pollersLabel = $derived.by(() => {
    const sDot = dashboard.pollers.scheduledRunning === true ? '●' : '○'
    const aDot = dashboard.pollers.alertsRunning === true ? '●' : '○'
    return `pollers: scheduled ${sDot}  alerts ${aDot}`
  })

  const msgCacheLabel = $derived.by(() => {
    const mc = dashboard.messageCache
    return `msg-cache: ${mc.size ?? 0} entries, ${mc.pendingWrites ?? 0} pending`
  })
</script>

<header>
  <div class="header-top">
    <h1>papai debug</h1>
    <span class="status-dot {dashboard.connected ? 'connected' : 'disconnected'}">
      ● {dashboard.connected ? 'connected' : 'disconnected'}
    </span>
    <span class="header-stat">uptime {uptime}</span>
    <span class="header-stat">msgs: {dashboard.stats.totalMessages}</span>
    <span class="header-stat">llm: {dashboard.stats.totalLlmCalls}</span>
    <span class="header-stat">tools: {dashboard.stats.totalToolCalls}</span>
  </div>
  <div class="header-infra">
    <span>{schedulerLabel}</span>
    <span class="infra-sep"></span>
    <span>{pollersLabel}</span>
    <span class="infra-sep"></span>
    <span>{msgCacheLabel}</span>
  </div>
</header>
