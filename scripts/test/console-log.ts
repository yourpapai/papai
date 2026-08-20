// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Segments Bun's console test output into per-file sections, failure blocks
 * with byte ranges, unhandled-error blocks, and the trailing run summary.
 *
 * Pure: it takes the captured log text plus the cwd the run happened in and
 * returns data. Nothing here reads the filesystem.
 *
 * The console log is the *only* trustworthy source of run totals — Bun's JUnit
 * output omits files that failed to load entirely, so a red run can serialise
 * as `failures="0"` (or produce no JUnit file at all).
 */

import { relative, resolve } from 'node:path'

/** A `(fail)` marker plus the diagnostic text Bun printed before it. */
export interface LogFailureBlock {
  /** Marker text, e.g. `outer > inner > deep fails`. */
  markerText: string
  /** Duration Bun reported on the marker line, in milliseconds. */
  ms: number
  /** Offset into the log text where the block starts. */
  offset: number
  /** Length of the block, ending at the end of its own marker line. */
  length: number
}

/** One file section of the log — everything printed under one file header. */
export interface LogSegment {
  /** Repo-relative path; `null` for output printed before any file header. */
  file: string | null
  blocks: LogFailureBlock[]
}

/** A `# Unhandled error between tests` block: no marker, no testcase. */
export interface LogRunError {
  file: string | null
  message: string
}

/** The trailing counts Bun prints once per run. */
export interface LogSummary {
  files: number
  tests: number
  pass: number
  fail: number
  skip: number
  expects: number
}

export interface SegmentedLog {
  segments: LogSegment[]
  runErrors: LogRunError[]
  summary: LogSummary | null
}

const UNHANDLED_HEADING = '# Unhandled error between tests'
const RULE_RE = /^-{3,}$/u
/** A file header: an unindented path with an extension, terminated by `:`. */
const FILE_HEADER_RE = /^([^\s:]\S*\.[A-Za-z0-9]+):$/u
const FAIL_MARKER_RE = /^\(fail\) (.+?) \[(\d+(?:\.\d+)?)(ms|s)\]$/u
/** Non-failing markers still close the block that precedes them. */
const OTHER_MARKER_RE = /^\((?:pass|skip|todo)\)[\s[]/u
const RAN_RE = /^Ran (\d+) tests? across (\d+) files?\./u
const COUNT_RE = /^\s*(\d+) (pass|fail|skip|todo|error)$/u
const EXPECTS_RE = /^\s*(\d+) expect\(\) calls$/u

interface LineInfo {
  /** The line without its terminator (and without a trailing `\r`). */
  text: string
  /** Offset of the first character of the line. */
  start: number
  /** Offset just past the last character, excluding the terminator. */
  end: number
  /** Offset of the first character of the next line. */
  next: number
}

function splitLines(text: string): LineInfo[] {
  const lines: LineInfo[] = []
  let position = 0
  while (position < text.length) {
    const newline = text.indexOf('\n', position)
    const stop = newline === -1 ? text.length : newline
    const carriage = stop > position && text.charAt(stop - 1) === '\r'
    const end = carriage ? stop - 1 : stop
    lines.push({
      text: text.slice(position, end),
      start: position,
      end,
      next: newline === -1 ? text.length : newline + 1,
    })
    if (newline === -1) break
    position = newline + 1
  }
  return lines
}

/** Resolves a header path against `cwd`, keeping out-of-tree paths relative. */
function normalizeFile(raw: string, cwd: string): string {
  const rel = relative(cwd, resolve(cwd, raw))
  return rel === '' ? raw : rel
}

function toCount(raw: string | undefined): number {
  return raw === undefined ? 0 : Number.parseInt(raw, 10)
}

/**
 * Walks backwards from the `Ran …` line over the contiguous count lines. The
 * contiguity requirement keeps a `N pass` string inside a source excerpt from
 * being mistaken for a run total.
 */
function collectCounts(lines: readonly LineInfo[], ranIndex: number): Map<string, number> {
  const counts = new Map<string, number>()
  for (let index = ranIndex - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line === undefined) break
    const expects = EXPECTS_RE.exec(line.text)
    if (expects !== null) {
      counts.set('expects', toCount(expects[1]))
      continue
    }
    const count = COUNT_RE.exec(line.text)
    if (count === null) break
    const key = count[2]
    if (key !== undefined) counts.set(key, toCount(count[1]))
  }
  return counts
}

function parseSummary(lines: readonly LineInfo[]): LogSummary | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line === undefined) continue
    const ran = RAN_RE.exec(line.text)
    if (ran === null) continue
    const counts = collectCounts(lines, index)
    return {
      files: toCount(ran[2]),
      tests: toCount(ran[1]),
      pass: counts.get('pass') ?? 0,
      fail: counts.get('fail') ?? 0,
      skip: counts.get('skip') ?? 0,
      expects: counts.get('expects') ?? 0,
    }
  }
  return null
}

interface ScanState {
  segments: LogSegment[]
  runErrors: LogRunError[]
  current: LogSegment | null
  blockStart: number
}

function currentSegment(state: ScanState): LogSegment {
  const existing = state.current
  if (existing !== null) return existing
  const segment: LogSegment = { file: null, blocks: [] }
  state.segments.push(segment)
  state.current = segment
  return segment
}

function openSegment(state: ScanState, file: string, blockStart: number): void {
  const segment: LogSegment = { file, blocks: [] }
  state.segments.push(segment)
  state.current = segment
  state.blockStart = blockStart
}

function recordFailure(state: ScanState, marker: RegExpExecArray, line: LineInfo): void {
  const value = Number.parseFloat(marker[2] ?? '0')
  const ms = marker[3] === 's' ? value * 1000 : value
  currentSegment(state).blocks.push({
    markerText: marker[1] ?? '',
    ms,
    offset: state.blockStart,
    length: Math.max(0, line.end - state.blockStart),
  })
  state.blockStart = line.next
}

/**
 * Consumes an unhandled-error block starting at its heading and returns the
 * index of the last line it swallowed.
 */
function collectRunError(state: ScanState, lines: readonly LineInfo[], headingIndex: number): number {
  const opener = lines[headingIndex + 1]
  const fenced = opener !== undefined && RULE_RE.test(opener.text)
  const messages: string[] = []
  let index = fenced ? headingIndex + 2 : headingIndex + 1
  while (index < lines.length) {
    const line = lines[index]
    if (line === undefined) break
    if (fenced ? RULE_RE.test(line.text) : line.text === '') break
    messages.push(line.text)
    index += 1
  }
  const segment = currentSegment(state)
  state.runErrors.push({ file: segment.file, message: messages.join('\n').trim() })
  const last = Math.min(index, lines.length - 1)
  const closer = lines[last]
  if (closer !== undefined) state.blockStart = closer.next
  return last
}

/**
 * Splits `text` into file sections and `(fail)` blocks with byte ranges.
 *
 * A block runs from the end of the previous marker line (or the file header)
 * through the end of its own marker line, so
 * `text.slice(offset, offset + length)` returns exactly the diagnostic Bun
 * printed for that failure plus its marker.
 */
export function segmentLog(text: string, cwd: string): SegmentedLog {
  const lines = splitLines(text)
  const state: ScanState = { segments: [], runErrors: [], current: null, blockStart: 0 }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined) continue
    const header = FILE_HEADER_RE.exec(line.text)
    if (header !== null) {
      openSegment(state, normalizeFile(header[1] ?? '', cwd), line.next)
      continue
    }
    if (line.text === UNHANDLED_HEADING) {
      index = collectRunError(state, lines, index)
      continue
    }
    const marker = FAIL_MARKER_RE.exec(line.text)
    if (marker !== null) {
      recordFailure(state, marker, line)
      continue
    }
    if (OTHER_MARKER_RE.test(line.text)) state.blockStart = line.next
  }
  return { segments: state.segments, runErrors: state.runErrors, summary: parseSummary(lines) }
}
