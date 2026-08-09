// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

/** One `<testcase>` element, normalized. */
export interface JUnitCase {
  /** Repo-relative, normalized to `/` separators. */
  file: string
  /** Leaf test name. */
  name: string
  /** Describe chain, outermost → innermost, un-reversed and unescaped. */
  suitePath: string[]
  ms: number
  line: number | null
  failed: boolean
}

export interface JUnitTotals {
  tests: number
  failures: number
  skipped: number
  assertions: number
  timeMs: number
}

/**
 * What the JUnit document says — nothing more.
 *
 * Deliberately carries no verdict: Bun omits files that fail to load and does not raise
 * `failures`, so a document can say `tests="2" failures="0"` for a run that exited 1.
 * Callers must take run totals from the console summary instead.
 */
export interface JUnitRun {
  totals: JUnitTotals
  byFile: Map<string, JUnitCase[]>
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
}

const ENTITY_PATTERN = /&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z]+));/gu
const ATTRIBUTE_PATTERN = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu
const TAG_NAME_PATTERN = /[A-Za-z0-9_:.-]/u
const FAILURE_CHILD_PATTERN = /<(?:failure|error)\b/u
const TESTCASE_CLOSE = '</testcase>'

/**
 * Resolve XML entity references in a single pass.
 *
 * Single-pass matters: `&amp;gt;` must become `&gt;`, not `>`. Bun's `classname` is escaped
 * twice, so the second decode is the caller's explicit choice (see {@link decodeClassname}).
 */
function decodeXmlOnce(raw: string): string {
  if (!raw.includes('&')) return raw
  return raw.replace(
    ENTITY_PATTERN,
    (match: string, hex: string | undefined, dec: string | undefined, named: string | undefined): string => {
      if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16))
      if (dec !== undefined) return String.fromCodePoint(Number.parseInt(dec, 10))
      if (named !== undefined) return NAMED_ENTITIES[named] ?? match
      return match
    },
  )
}

/**
 * Turn a JUnit `classname` into the describe chain, outermost first.
 *
 * Bun writes the chain **reversed** and joins it with an already-escaped `&gt;`, then escapes
 * the whole attribute — so `classname="inner &amp;gt; outer"` is the console's
 * `outer > inner > …`. Decode twice, split on ` > `, reverse.
 */
export function decodeClassname(raw: string): string[] {
  const decoded = decodeXmlOnce(decodeXmlOnce(raw))
  return decoded
    .split(' > ')
    .filter((segment) => segment.length > 0)
    .reverse()
}

interface XmlTag {
  name: string
  attrs: Map<string, string>
  selfClosing: boolean
  /** Index just past the tag's closing `>`. */
  end: number
}

function parseAttributes(source: string): Map<string, string> {
  const attrs = new Map<string, string>()
  ATTRIBUTE_PATTERN.lastIndex = 0
  let match = ATTRIBUTE_PATTERN.exec(source)
  while (match !== null) {
    attrs.set(match[1] ?? '', match[2] ?? match[3] ?? '')
    match = ATTRIBUTE_PATTERN.exec(source)
  }
  return attrs
}

/**
 * Read the tag starting at `openIndex` (which must point at `<`).
 *
 * Quote-aware on purpose: Bun leaves a literal `>` inside `classname`, so scanning to the first
 * `>` would truncate the element and lose its remaining attributes.
 */
function readTag(xml: string, openIndex: number): XmlTag | null {
  let cursor = openIndex + 1
  while (cursor < xml.length && TAG_NAME_PATTERN.test(xml.charAt(cursor))) cursor += 1
  const name = xml.slice(openIndex + 1, cursor)

  const attrStart = cursor
  let quote = ''
  while (cursor < xml.length) {
    const char = xml.charAt(cursor)
    if (quote !== '') {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '>') {
      break
    }
    cursor += 1
  }
  if (cursor >= xml.length) return null

  const raw = xml.slice(attrStart, cursor)
  return { name, attrs: parseAttributes(raw), selfClosing: raw.trimEnd().endsWith('/'), end: cursor + 1 }
}

function toInt(raw: string | undefined): number {
  if (raw === undefined) return 0
  const value = Number.parseInt(raw, 10)
  return Number.isNaN(value) ? 0 : value
}

function toSeconds(raw: string | undefined): number {
  if (raw === undefined) return 0
  const value = Number.parseFloat(raw)
  return Number.isNaN(value) ? 0 : value
}

/** Repo-relative for in-tree files; `../…` for the out-of-tree absolute paths Bun emits. */
function normalizeFile(raw: string, cwd: string): string {
  const decoded = decodeXmlOnce(raw)
  if (decoded === '') return ''
  const relative = path.isAbsolute(decoded) ? path.relative(cwd, decoded) : path.normalize(decoded)
  return relative.split(path.sep).join('/')
}

function readTotals(xml: string): JUnitTotals {
  const rootIndex = xml.indexOf('<testsuites')
  const root = rootIndex < 0 ? null : readTag(xml, rootIndex)
  const attrs = root?.attrs ?? new Map<string, string>()
  return {
    tests: toInt(attrs.get('tests')),
    failures: toInt(attrs.get('failures')),
    skipped: toInt(attrs.get('skipped')),
    assertions: toInt(attrs.get('assertions')),
    timeMs: toSeconds(attrs.get('time')) * 1000,
  }
}

/**
 * Whether the element opened by `tag` has a `<failure>` or `<error>` child.
 *
 * `type` is intentionally ignored: Bun writes `AssertionError` even for a thrown plain `Error`,
 * so it carries no information.
 */
function readFailure(xml: string, tag: XmlTag): { failed: boolean; next: number } {
  if (tag.selfClosing) return { failed: false, next: tag.end }
  const closeIndex = xml.indexOf(TESTCASE_CLOSE, tag.end)
  if (closeIndex < 0) return { failed: FAILURE_CHILD_PATTERN.test(xml.slice(tag.end)), next: xml.length }
  return {
    failed: FAILURE_CHILD_PATTERN.test(xml.slice(tag.end, closeIndex)),
    next: closeIndex + TESTCASE_CLOSE.length,
  }
}

function buildCase(tag: XmlTag, failed: boolean, suiteFile: string, cwd: string): JUnitCase {
  const rawFile = tag.attrs.get('file')
  const lineAttr = tag.attrs.get('line')
  const line = lineAttr === undefined ? null : toInt(lineAttr)
  return {
    file: rawFile === undefined ? suiteFile : normalizeFile(rawFile, cwd),
    name: decodeXmlOnce(tag.attrs.get('name') ?? ''),
    suitePath: decodeClassname(tag.attrs.get('classname') ?? ''),
    ms: toSeconds(tag.attrs.get('time')) * 1000,
    line,
    failed,
  }
}

/**
 * Parse Bun's JUnit reporter output into per-file, document-ordered test cases.
 *
 * Reports the document faithfully — correcting its known under-reporting is the report
 * builder's job, using the console summary.
 */
export function parseJUnit(xml: string, cwd: string): JUnitRun {
  const byFile = new Map<string, JUnitCase[]>()
  let suiteFile = ''
  let cursor = 0

  while (cursor < xml.length) {
    const openIndex = xml.indexOf('<', cursor)
    if (openIndex < 0) break
    const tag = readTag(xml, openIndex)
    if (tag === null) break
    cursor = tag.end

    if (tag.name === 'testsuite') {
      const rawFile = tag.attrs.get('file')
      if (rawFile !== undefined) suiteFile = normalizeFile(rawFile, cwd)
      continue
    }
    if (tag.name !== 'testcase') continue

    const { failed, next } = readFailure(xml, tag)
    cursor = next
    const testCase = buildCase(tag, failed, suiteFile, cwd)
    const existing = byFile.get(testCase.file)
    if (existing === undefined) byFile.set(testCase.file, [testCase])
    else existing.push(testCase)
  }

  return { totals: readTotals(xml), byFile }
}
