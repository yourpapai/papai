<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tool Surface Benchmark Results

## Summary

| Model                   | Mode          | Runs | Success Rate | Avg Tool Calls | Avg Steps | Failures                                    |
| ----------------------- | ------------- | ---: | -----------: | -------------: | --------: | ------------------------------------------- |
| hf:moonshotai/Kimi-K2.6 | direct_full   |   10 |        40.0% |            1.8 |       2.5 | validation_failed: 5, confirmation_error: 1 |
| hf:moonshotai/Kimi-K2.6 | direct_routed |   10 |        50.0% |            1.7 |       2.5 | validation_failed: 4, confirmation_error: 1 |

## Scenario Detail

| Model                   | Mode          | Scenario                           | Runs | Success Rate | Avg Tool Calls | Avg Steps | Top Failure        | Failure Message                                                                                     |
| ----------------------- | ------------- | ---------------------------------- | ---: | -----------: | -------------: | --------: | ------------------ | --------------------------------------------------------------------------------------------------- |
| hf:moonshotai/Kimi-K2.6 | direct_full   | ambiguous_but_solvable_task_update |    1 |         0.0% |            3.0 |       3.0 | validation_failed  | Scenario ambiguous_but_solvable_task_update remained in an unexpected final state after 3 attempts. |
| hf:moonshotai/Kimi-K2.6 | direct_full   | create_basic_task                  |    1 |       100.0% |            1.0 |       2.0 | none               | none                                                                                                |
| hf:moonshotai/Kimi-K2.6 | direct_full   | deferred_prompt_creation           |    1 |         0.0% |            1.0 |       2.0 | validation_failed  | Scenario deferred_prompt_creation remained in an unexpected final state after 3 attempts.           |
| hf:moonshotai/Kimi-K2.6 | direct_full   | delete_needs_confirmation          |    1 |         0.0% |            2.0 |       3.0 | confirmation_error | Scenario delete_needs_confirmation remained in an unexpected final state after 3 attempts.          |
| hf:moonshotai/Kimi-K2.6 | direct_full   | list_or_search_read_only           |    1 |       100.0% |            1.0 |       2.0 | none               | none                                                                                                |
| hf:moonshotai/Kimi-K2.6 | direct_full   | recurring_task_creation            |    1 |         0.0% |            1.0 |       2.0 | validation_failed  | Scenario recurring_task_creation remained in an unexpected final state after 3 attempts.            |
| hf:moonshotai/Kimi-K2.6 | direct_full   | search_then_assign_user            |    1 |       100.0% |            3.0 |       3.0 | none               | none                                                                                                |
| hf:moonshotai/Kimi-K2.6 | direct_full   | search_then_comment                |    1 |         0.0% |            2.0 |       3.0 | validation_failed  | Scenario search_then_comment remained in an unexpected final state after 3 attempts.                |
| hf:moonshotai/Kimi-K2.6 | direct_full   | search_then_update_status          |    1 |         0.0% |            2.0 |       3.0 | validation_failed  | Scenario search_then_update_status remained in an unexpected final state after 3 attempts.          |
| hf:moonshotai/Kimi-K2.6 | direct_full   | time_plus_web_lookup               |    1 |       100.0% |            2.0 |       2.0 | none               | none                                                                                                |
| hf:moonshotai/Kimi-K2.6 | direct_routed | ambiguous_but_solvable_task_update |    1 |         0.0% |            2.0 |       3.0 | validation_failed  | Scenario ambiguous_but_solvable_task_update remained in an unexpected final state after 3 attempts. |
| hf:moonshotai/Kimi-K2.6 | direct_routed | create_basic_task                  |    1 |       100.0% |            1.0 |       2.0 | none               | none                                                                                                |
| hf:moonshotai/Kimi-K2.6 | direct_routed | deferred_prompt_creation           |    1 |         0.0% |            1.0 |       2.0 | validation_failed  | Scenario deferred_prompt_creation remained in an unexpected final state after 3 attempts.           |
| hf:moonshotai/Kimi-K2.6 | direct_routed | delete_needs_confirmation          |    1 |         0.0% |            2.0 |       3.0 | confirmation_error | Scenario delete_needs_confirmation remained in an unexpected final state after 3 attempts.          |
| hf:moonshotai/Kimi-K2.6 | direct_routed | list_or_search_read_only           |    1 |       100.0% |            1.0 |       2.0 | none               | none                                                                                                |
| hf:moonshotai/Kimi-K2.6 | direct_routed | recurring_task_creation            |    1 |         0.0% |            1.0 |       2.0 | validation_failed  | Scenario recurring_task_creation remained in an unexpected final state after 3 attempts.            |
| hf:moonshotai/Kimi-K2.6 | direct_routed | search_then_assign_user            |    1 |       100.0% |            3.0 |       3.0 | none               | none                                                                                                |
| hf:moonshotai/Kimi-K2.6 | direct_routed | search_then_comment                |    1 |         0.0% |            2.0 |       3.0 | validation_failed  | Scenario search_then_comment remained in an unexpected final state after 3 attempts.                |
| hf:moonshotai/Kimi-K2.6 | direct_routed | search_then_update_status          |    1 |       100.0% |            2.0 |       3.0 | none               | none                                                                                                |
| hf:moonshotai/Kimi-K2.6 | direct_routed | time_plus_web_lookup               |    1 |       100.0% |            2.0 |       2.0 | none               | none                                                                                                |
