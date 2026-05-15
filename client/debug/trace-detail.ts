// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LlmTrace } from '../../src/debug/schemas.js'
import { escapeHtml, formatTime, formatTokens } from './helpers.js'

type TraceModalElements = {
  $traceModal: HTMLElement
  $traceModalTitle: HTMLElement
  $traceModalBody: HTMLElement
  $traceModalClose: HTMLElement
}

export function getTraceModalElements(): TraceModalElements {
  return {
    $traceModal: document.getElementById('trace-modal')!,
    $traceModalTitle: document.getElementById('trace-modal-title')!,
    $traceModalBody: document.getElementById('trace-modal-body')!,
    $traceModalClose: document.getElementById('trace-modal-close')!,
  }
}

function renderBasicInfo(trace: LlmTrace): string {
  const hasError = trace.error !== undefined && trace.error !== ''
  return `<div class="trace-detail-section">
    <h4>Basic Info</h4>
    <div class="trace-detail-grid">
      <div class="trace-detail-item"><div class="label">User ID</div><div class="value">${escapeHtml(trace.userId)}</div></div>
      <div class="trace-detail-item"><div class="label">Timestamp</div><div class="value">${formatTime(trace.timestamp)}</div></div>
      <div class="trace-detail-item"><div class="label">Model</div><div class="value">${escapeHtml(trace.model)}</div></div>
      ${trace.actualModel !== undefined && trace.actualModel !== '' ? `<div class="trace-detail-item"><div class="label">Actual Model</div><div class="value">${escapeHtml(trace.actualModel)}</div></div>` : ''}
      <div class="trace-detail-item"><div class="label">Duration</div><div class="value">${(trace.duration / 1000).toFixed(2)}s</div></div>
      <div class="trace-detail-item"><div class="label">Steps</div><div class="value">${trace.steps}</div></div>
      ${trace.finishReason !== undefined && trace.finishReason !== '' ? `<div class="trace-detail-item"><div class="label">Finish Reason</div><div class="value">${escapeHtml(trace.finishReason)}</div></div>` : ''}
      ${trace.responseId !== undefined && trace.responseId !== '' ? `<div class="trace-detail-item"><div class="label">Response ID</div><div class="value">${escapeHtml(trace.responseId)}</div></div>` : ''}
      ${trace.messageCount === undefined ? '' : `<div class="trace-detail-item"><div class="label">Messages</div><div class="value">${trace.messageCount}</div></div>`}
      ${trace.toolCount === undefined ? '' : `<div class="trace-detail-item"><div class="label">Tools Available</div><div class="value">${trace.toolCount}</div></div>`}
      ${hasError ? `<div class="trace-detail-item"><div class="label">Error</div><div class="value error">${escapeHtml(trace.error!)}</div></div>` : ''}
    </div>
  </div>`
}

function renderTokenUsage(trace: LlmTrace): string {
  return `<div class="trace-detail-section">
    <h4>Token Usage</h4>
    <div class="trace-detail-grid">
      <div class="trace-detail-item"><div class="label">Input</div><div class="value">${formatTokens(trace.totalTokens.inputTokens)}</div></div>
      <div class="trace-detail-item"><div class="label">Output</div><div class="value">${formatTokens(trace.totalTokens.outputTokens)}</div></div>
      <div class="trace-detail-item"><div class="label">Total</div><div class="value">${formatTokens(trace.totalTokens.inputTokens + trace.totalTokens.outputTokens)}</div></div>
    </div>
  </div>`
}

function renderToolCalls(trace: LlmTrace): string {
  if (trace.toolCalls === undefined || trace.toolCalls.length === 0) return ''

  let items = ''
  for (const tc of trace.toolCalls) {
    const status = tc.success ? '✓ success' : '✗ failed'
    const statusClass = tc.success ? 'success' : 'error'
    let details = `<div class="tool-call-summary">
      <span class="tool-name">${escapeHtml(tc.toolName)}</span>
      <span class="tool-duration">${tc.durationMs}ms</span>
      <span class="tool-status ${statusClass}">${status}</span>
    </div>`

    if (tc.toolCallId !== undefined) {
      details += `<div class="tool-call-id">ID: ${escapeHtml(tc.toolCallId)}</div>`
    }

    if (tc.args !== undefined) {
      details += `<div class="tool-section"><div class="label">Arguments</div><pre class="tool-json">${escapeHtml(JSON.stringify(tc.args, null, 2))}</pre></div>`
    }

    if (tc.result !== undefined) {
      details += `<div class="tool-section"><div class="label">Result</div><pre class="tool-json">${escapeHtml(JSON.stringify(tc.result, null, 2))}</pre></div>`
    }

    if (tc.error !== undefined && tc.error !== '') {
      details += `<div class="tool-section"><div class="label">Error</div><pre class="tool-json error">${escapeHtml(tc.error)}</pre></div>`
    }

    items += `<div class="tool-call-item">${details}</div>`
  }

  return `<div class="trace-detail-section">
    <h4>Tool Calls (${trace.toolCalls.length})</h4>
    <div class="tool-calls-list">${items}</div>
  </div>`
}

function renderStepToolCall(
  tc: NonNullable<NonNullable<LlmTrace['stepsDetail']>[number]['toolCalls']>[number],
): string {
  const hasError = tc.error !== undefined && tc.error !== ''
  let html = `<div class="step-tool-call ${hasError ? 'step-tool-error' : ''}">
    <div class="step-tool-call-header">
      <span class="tool-name">${escapeHtml(tc.toolName)}</span>
      <span class="tool-id">${escapeHtml(tc.toolCallId)}</span>
    </div>`

  if (tc.args !== undefined) {
    html += `<div class="tool-section"><div class="label">Arguments</div><pre class="tool-json">${escapeHtml(JSON.stringify(tc.args, null, 2))}</pre></div>`
  }

  if (tc.result !== undefined) {
    html += `<div class="tool-section"><div class="label">Result</div><pre class="tool-json">${escapeHtml(JSON.stringify(tc.result, null, 2))}</pre></div>`
  }

  if (hasError) {
    html += `<div class="tool-section"><div class="label">Error</div><pre class="tool-json error">${escapeHtml(tc.error!)}</pre></div>`
  }

  html += '</div>'
  return html
}

function renderStepsDetail(trace: LlmTrace): string {
  if (trace.stepsDetail === undefined || trace.stepsDetail.length === 0) return ''

  let items = ''
  for (const step of trace.stepsDetail) {
    let stepHtml = `<div class="step-item">
      <div class="step-header">Step ${step.stepNumber}${step.finishReason === undefined || step.finishReason === '' ? '' : ` <span class="step-finish-reason">(${escapeHtml(step.finishReason)})</span>`}</div>`

    if (step.text !== undefined && step.text !== '') {
      stepHtml += `<div class="step-section"><div class="label">Generated Text</div><pre class="step-text">${escapeHtml(step.text)}</pre></div>`
    }

    if (step.toolCalls !== undefined && step.toolCalls.length > 0) {
      stepHtml += '<div class="step-tool-calls">'
      for (const tc of step.toolCalls) {
        stepHtml += renderStepToolCall(tc)
      }
      stepHtml += '</div>'
    }

    if (step.usage !== undefined) {
      stepHtml += `<div class="step-usage">
        Tokens: ${formatTokens(step.usage.inputTokens)} in / ${formatTokens(step.usage.outputTokens)} out
      </div>`
    }

    stepHtml += '</div>'
    items += stepHtml
  }

  return `<div class="trace-detail-section">
    <h4>Steps Detail (${trace.stepsDetail.length})</h4>
    <div class="steps-list">${items}</div>
  </div>`
}

function renderGeneratedText(trace: LlmTrace): string {
  if (trace.generatedText === undefined || trace.generatedText === '') return ''

  return `<div class="trace-detail-section">
    <h4>Generated Response</h4>
    <pre class="generated-text">${escapeHtml(trace.generatedText)}</pre>
  </div>`
}

export function renderTraceDetail(trace: LlmTrace, elements: ReturnType<typeof getTraceModalElements>): void {
  const { $traceModal, $traceModalTitle, $traceModalBody } = elements

  $traceModalTitle.textContent = `LLM Trace: ${escapeHtml(trace.model)}`

  let html = ''
  html += renderBasicInfo(trace)
  html += renderTokenUsage(trace)
  html += renderGeneratedText(trace)
  html += renderStepsDetail(trace)
  html += renderToolCalls(trace)

  $traceModalBody.innerHTML = html
  $traceModal.hidden = false
}
