// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const runSequentially = async <Input, Output>(
  values: readonly Input[],
  operation: (value: Input, index: number) => Promise<Output>,
): Promise<readonly Output[]> => {
  const outputs: Output[] = []
  const visit = async (index: number): Promise<void> => {
    const value = values[index]
    if (value === undefined) return
    outputs.push(await operation(value, index))
    await visit(index + 1)
  }
  await visit(0)
  return outputs
}
