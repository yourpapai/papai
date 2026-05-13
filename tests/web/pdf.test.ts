import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { getDocumentProxy } from 'unpdf'

import { extractPdfText, type PdfDeps } from '../../src/web/pdf.js'
import { mockLogger } from '../utils/test-helpers.js'

const MINIMAL_PDF = new TextEncoder().encode(
  '%PDF-1.1\n' +
    '1 0 obj\n' +
    '<< /Type /Catalog /Pages 2 0 R >>\n' +
    'endobj\n' +
    '2 0 obj\n' +
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n' +
    'endobj\n' +
    '3 0 obj\n' +
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >>\n' +
    'endobj\n' +
    '4 0 obj\n' +
    '<< /Length 44 >>\n' +
    'stream\n' +
    'BT\n' +
    '/F1 24 Tf\n' +
    '100 100 Td\n' +
    '(Hello) Tj\n' +
    'ET\n' +
    'endstream\n' +
    'endobj\n' +
    'xref\n' +
    '0 5\n' +
    '0000000000 65535 f \n' +
    '0000000010 00000 n \n' +
    '0000000063 00000 n \n' +
    '0000000122 00000 n \n' +
    '0000000212 00000 n \n' +
    'trailer\n' +
    '<< /Root 1 0 R /Size 5 >>\n' +
    'startxref\n' +
    '300\n' +
    '%%EOF',
)

describe('extractPdfText', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('returns merged PDF text', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70])
    const document = await getDocumentProxy(MINIMAL_PDF)
    const extractTextSpy = mock((_data: Parameters<PdfDeps['extractText']>[0], _options: { mergePages: true }) =>
      Promise.resolve({ text: '\nPage one\n\nPage two\n', totalPages: 2 }),
    )

    function extractText(
      _data: Parameters<PdfDeps['extractText']>[0],
      options?: { mergePages?: false },
    ): Promise<{ totalPages: number; text: string[] }>
    function extractText(
      data: Parameters<PdfDeps['extractText']>[0],
      options: { mergePages: true },
    ): Promise<{ totalPages: number; text: string }>
    function extractText(
      data: Parameters<PdfDeps['extractText']>[0],
      options?: { mergePages?: boolean },
    ): Promise<{ totalPages: number; text: string[] } | { totalPages: number; text: string }> {
      assert(options?.mergePages === true)
      return extractTextSpy(data, { mergePages: true })
    }

    const deps: PdfDeps = {
      getDocumentProxy: mock((_data: Parameters<PdfDeps['getDocumentProxy']>[0]) => Promise.resolve(document)),
      extractText,
    }

    await expect(extractPdfText(bytes, deps)).resolves.toBe('Page one\n\nPage two')
    expect(deps.getDocumentProxy).toHaveBeenCalledWith(bytes)
    expect(extractTextSpy).toHaveBeenCalledWith(document, { mergePages: true })
  })
})
