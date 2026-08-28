// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Force chalk's color level on before ink (and its chalk) initializes, so
 * suites asserting ANSI color escapes in ink-testing-library frames see
 * them: chalk reads FORCE_COLOR at import time, so this module must be the
 * first import of any color-asserting suite. Monochrome legs assert escape
 * absence with `colorMode: 'monochrome'` props — with color forced on,
 * absence proves the props were omitted, not that chalk was asleep.
 */
process.env['FORCE_COLOR'] = '1'
