// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

interface Totals {
  code: number
  blanks: number
  comments: number
}

interface Point extends Totals {
  sha: string
  date: number
  subject: string
}

function buildStyle(): string {
  return [
    ':root { color-scheme: dark; }',
    '* { box-sizing: border-box; }',
    'body { margin: 0; padding: 32px 24px 48px; background: #0b0f14; color: #e6edf3;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }',
    '.wrap { max-width: 1100px; margin: 0 auto; }',
    'h1 { font-size: 22px; font-weight: 600; margin: 0 0 4px; }',
    '.meta { color: #8b949e; font-size: 13px; margin-bottom: 20px; white-space: pre-line; }',
    '.cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }',
    '.card { background: #161b22; border: 1px solid #21262d; border-radius: 10px;',
    '  padding: 12px 18px; min-width: 150px; }',
    '.card .v { font-size: 22px; font-weight: 650; color: #58a6ff; }',
    '.card .k { font-size: 12px; color: #8b949e; margin-top: 2px; }',
    '.controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }',
    '.group { display: inline-flex; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }',
    'button { appearance: none; border: none; background: #161b22; color: #c9d1d9; cursor: pointer;',
    '  padding: 7px 14px; font-size: 13px; border-right: 1px solid #30363d; }',
    'button:last-child { border-right: none; }',
    'button:hover { background: #21262d; }',
    'button.active { background: #1f6feb; color: #fff; }',
    '.chartbox { position: relative; height: 480px; background: #0d1117;',
    '  border: 1px solid #21262d; border-radius: 10px; padding: 16px; }',
    '.hint { color: #6e7681; font-size: 12px; margin-top: 12px; text-align: center; }',
  ].join('\n')
}

function buildHead(meta: Record<string, string>): string {
  const repo = meta['repo'] ?? ''
  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Code growth — ${repo}</title>`,
    '<script src="https://cdn.jsdelivr.net/npm/hammerjs@2.0.8/hammer.min.js"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.2.0/dist/chartjs-plugin-zoom.min.js"></script>',
    `<style>\n${buildStyle()}\n</style>`,
  ].join('\n')
}

function buildBody(meta: Record<string, string>): string {
  const repo = meta['repo'] ?? ''
  const base = meta['base'] ?? ''
  const plotted = meta['plotted'] ?? ''
  const totalCommits = meta['totalCommits'] ?? ''
  const tokeiVersion = meta['tokeiVersion'] ?? ''
  const generatedAt = meta['generatedAt'] ?? ''
  return [
    '<div class="wrap">',
    `  <h1>Code growth — ${repo}</h1>`,
    `  <div class="meta">base: ${base} · plotted ${plotted} of ${totalCommits} commits · tokei ${tokeiVersion} (-C) over src/ plugins/ client/ · generated ${generatedAt}</div>`,
    '  <div class="cards" id="cards"></div>',
    '  <div class="controls">',
    '    <span class="group" id="metric-group">',
    '      <button data-metric="code" class="active">Lines of code</button>',
    '      <button data-metric="comments">Comments</button>',
    '      <button data-metric="blanks">Blanks</button>',
    '    </span>',
    '    <span class="group" id="scale-group">',
    '      <button data-scale="linear" class="active">Linear</button>',
    '      <button data-scale="logarithmic">Log</button>',
    '    </span>',
    '    <button id="reset-zoom">Reset zoom</button>',
    '  </div>',
    '  <div class="chartbox"><canvas id="chart"></canvas></div>',
    '  <div class="hint">drag or scroll to zoom · drag axis to pan · hover points for commit details</div>',
    '</div>',
  ].join('\n')
}

function buildScriptHeader(): string {
  return [
    'var D = window.LOC_DATA;',
    'var METRICS = {',
    "  code:     { label: 'lines of code',    color: '#58a6ff' },",
    "  comments: { label: 'comment lines',    color: '#3fb950' },",
    "  blanks:   { label: 'blank lines',      color: '#8b949e' }",
    '};',
    "var metricKey = 'code';",
    'function fmtDate(unix) {',
    "  return new Date(unix * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });",
    '}',
    'function compact(v) {',
    "  return Intl.NumberFormat(undefined, { notation: 'compact' }).format(v);",
    '}',
    'var labels = D.map(function (p) { return fmtDate(p.date); });',
    "var gridColor = 'rgba(139,148,158,0.12)';",
    "var tickColor = '#8b949e';",
  ].join('\n')
}

function buildChartDataset(): string {
  return [
    '  data: {',
    '    labels: labels,',
    '    datasets: [{',
    '      data: D.map(function (p) { return p[metricKey]; }),',
    '      borderColor: METRICS[metricKey].color,',
    "      backgroundColor: 'rgba(88,166,255,0.10)',",
    '      fill: true, pointRadius: 0, pointHoverRadius: 4,',
    '      borderWidth: 2, tension: 0.15',
    '    }]',
    '  },',
  ].join('\n')
}

function buildChartPlugins(): string {
  return [
    '    plugins: {',
    '      legend: { display: false },',
    '      tooltip: {',
    "        backgroundColor: '#161b22', borderColor: '#30363d', borderWidth: 1,",
    "        titleColor: '#e6edf3', bodyColor: '#c9d1d9', padding: 10,",
    '        callbacks: {',
    '          title: function (items) {',
    '            var p = D[items[0].dataIndex];',
    "            return fmtDate(p.date) + '  ·  ' + p.sha.slice(0, 10);",
    '          },',
    '          label: function (item) {',
    '            var p = D[item.dataIndex];',
    '            return [',
    "              ' ' + item.parsed.y.toLocaleString() + ' ' + METRICS[metricKey].label,",
    "              p.subject.length > 90 ? p.subject.slice(0, 87) + '…' : p.subject",
    '            ];',
    '          }',
    '        }',
    '      },',
    '      zoom: {',
    "        zoom: { wheel: { enabled: true }, drag: { enabled: true }, mode: 'x' },",
    "        pan: { enabled: true, mode: 'x' },",
    '        limits: { x: { minRange: 5 } }',
    '      }',
    '    },',
  ].join('\n')
}

function buildChartScales(): string {
  return [
    '    scales: {',
    '      x: {',
    '        grid: { color: gridColor },',
    '        ticks: { maxTicksLimit: 12, color: tickColor, maxRotation: 0 }',
    '      },',
    '      y: {',
    "        type: 'linear',",
    '        grid: { color: gridColor },',
    '        ticks: { color: tickColor, callback: function (v) { return compact(v); } }',
    '      }',
    '    },',
  ].join('\n')
}

function buildChartConfig(): string {
  return [
    "var chart = new Chart(document.getElementById('chart'), {",
    "  type: 'line',",
    buildChartDataset(),
    '  options: {',
    '    responsive: true,',
    '    maintainAspectRatio: false,',
    '    animation: false,',
    "    interaction: { mode: 'nearest', axis: 'x', intersect: false },",
    buildChartPlugins(),
    buildChartScales(),
    '  }',
    '});',
  ].join('\n')
}

function buildMetricSwitch(): string {
  return [
    'function setMetric(key) {',
    '  metricKey = key;',
    '  var ds = chart.data.datasets[0];',
    '  ds.data = D.map(function (p) { return p[key]; });',
    '  ds.borderColor = METRICS[key].color;',
    "  ds.backgroundColor = key === 'code' ? 'rgba(88,166,255,0.10)' : 'rgba(63,185,80,0.08)';",
    '  chart.update();',
    '}',
    "document.querySelectorAll('#metric-group button').forEach(function (b) {",
    "  b.addEventListener('click', function () {",
    "    document.querySelectorAll('#metric-group button').forEach(function (x) { x.classList.remove('active'); });",
    "    b.classList.add('active');",
    '    setMetric(b.dataset.metric);',
    '  });',
    '});',
  ].join('\n')
}

function buildScaleSwitch(): string {
  return [
    "document.querySelectorAll('#scale-group button').forEach(function (b) {",
    "  b.addEventListener('click', function () {",
    "    document.querySelectorAll('#scale-group button').forEach(function (x) { x.classList.remove('active'); });",
    "    b.classList.add('active');",
    '    chart.options.scales.y.type = b.dataset.scale;',
    '    chart.update();',
    '  });',
    '});',
    "document.getElementById('reset-zoom').addEventListener('click', function () { chart.resetZoom(); });",
  ].join('\n')
}

function buildCardsScript(): string {
  return [
    '(function cards() {',
    '  var first = D[0], last = D[D.length - 1];',
    '  var peak = D.reduce(function (a, p) { return p.code > a.code ? p : a; }, first);',
    "  var growth = first.code > 0 ? (last.code / first.code).toFixed(1) + '×' : '—';",
    '  var rows = [',
    "    [last.code.toLocaleString(), 'lines of code (latest)'],",
    "    ['+' + (last.code - first.code).toLocaleString(), 'added since first commit'],",
    "    [growth, 'growth factor'],",
    "    [peak.code.toLocaleString(), 'peak (' + fmtDate(peak.date) + ')'],",
    "    [String(D.length), 'commits plotted']",
    '  ];',
    "  document.getElementById('cards').innerHTML = rows.map(function (r) {",
    '    return \'<div class="card"><div class="v">\' + r[0] + \'</div><div class="k">\' + r[1] + \'</div></div>\';',
    "  }).join('');",
    '})();',
  ].join('\n')
}

function buildScript(): string {
  return [buildScriptHeader(), buildChartConfig(), buildMetricSwitch(), buildScaleSwitch(), buildCardsScript()].join(
    '\n',
  )
}

export function renderHtml(points: Point[], meta: Record<string, string>): string {
  const data = JSON.stringify(points).replaceAll('<', String.raw`\u003c`)
  const metaJson = JSON.stringify(meta, null, 2).replaceAll('<', String.raw`\u003c`)
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    buildHead(meta),
    '</head>',
    '<body>',
    buildBody(meta),
    `<script>window.LOC_DATA = ${data};window.LOC_META = ${metaJson};</script>`,
    '<script>',
    buildScript(),
    '</script>',
    '</body>',
    '</html>',
  ].join('\n')
}
