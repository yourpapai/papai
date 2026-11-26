## ADDED Requirements

### Requirement: The gate's file scope is product code

The gate SHALL treat a changed file as gateable only when it is an implementation source file
under a product root — the application source tree, the client application tree, or the plugin
tree. Files under internal infrastructure and tooling workspaces SHALL NOT be gateable, whatever
test coverage they carry. Test files, generated sources, locale data and
instrumentation-incompatible sources SHALL remain excluded as they are today.

A branch whose diff contains no gateable file SHALL produce an empty target set and SHALL NOT fail
on that account.

The same predicate SHALL decide gateability for every consumer that asks the question, so the
mutation gate and the local write-time checks never disagree about whether a file is gateable.

#### Scenario: A product-code change is gated

- **WHEN** a branch changes an implementation source file under the application, client or plugin
  tree
- **THEN** that file is selected as a mutation target and its score is judged against its recorded
  floor

#### Scenario: An infrastructure-only branch selects nothing and passes

- **WHEN** a branch changes only implementation files in tooling or internal workspaces, together
  with their tests
- **THEN** the run reports zero targets, measures nothing, and exits zero — the empty target set is
  the correct verdict, not a missing measurement

#### Scenario: A dropped root's recorded floors stop being enforced

- **WHEN** a root that was previously gateable is removed from the product roots
- **THEN** no run selects a file under it, and any floor still recorded for such a file is
  unreachable rather than silently enforced against a score that can no longer be produced

#### Scenario: Path mapping outlives gateability

- **WHEN** a workspace is no longer gateable but its sources still map to a parallel tests
  directory
- **THEN** that mapping continues to resolve, so affected-test selection and companion-test
  lookup keep working for it

#### Scenario: A test file under a product root is never a target

- **WHEN** a branch changes a test file that lives under a product root
- **THEN** it is not selected as a mutation target
