@stage
Feature: Stage

    Users should be allowed to tie together jobs from the same pipeline so that they can
    convey the nature of the jobs in the workflow graph. They can either
    set setup and teardown jobs explicitly or it will be created implicitly as a virtual job.

    Eg: The following pipeline workflows:
        stageFail1: (~commit) -> (hub) -> (a) -> (b) -> (c) -> (target)

        stageFail2: (~commit) -> (hub) -> (a) -> (b) -> (c) -> (target)

        stageSuccess1: (~commit) -> (hub) -> (a) -> (b) -> (c) -> (target)

        Assume a, b, and c are part of a stage.

    Rules:
        - Users should be able to define pipeline stages, and add a job to a stage.
        - A job can belong to only one stage.
        - Relation between jobs will still be defined using requires.
        - Jobs with empty requires (requires:[]) indicate the start of a stage.
        - Setup and teardown jobs can be implicitly or explicitly created.
        - When a setup/teardown job is implicitly created, it will be virtual and will not actually run.
        - Teardown build should run when any job in a stage is terminal; downstream jobs should not continue, and stageBuild should be updated accordingly
        - Setup build should run before a stage.


    Scenario: Downstream builds are not triggered if required stage is not successful.
        Given an existing pipeline on branch "stageFail1" with stage "simple_fail" with the workflow jobs:
            | job       | requires      |
            | target    | ~stage@simple_fail:teardown  |
        When the "hub" job on branch "stageFail1" is started
        And the "hub" build succeeded
        And the "a" job is triggered and succeeds
        And the "b" job is triggered and succeeds
        And the "c" job is triggered and fails
        Then the "~stage@simple_fail" stageBuild status is "FAILURE"
        And the "~stage@simple_fail:teardown" job is started
        And the "target" job on branch "stageFail1" is not started

    Scenario: Downstream builds within a stage are not triggered if upstream build in stage is not successful.
        Given an existing pipeline on branch "stageFail2" with stage "incomplete_fail" with the workflow jobs:
            | job       | requires      |
            | b    | a  |
            | c    | b  |
            | target    | ~stage@incomplete_fail:teardown  |
        When the "hub" job on branch "stageFail2" is started
        And the "hub" build succeeded
        And the "a" job is triggered and succeeds
        And the "b" job is triggered and fails
        Then the "~stage@incomplete_fail" stageBuild status is "FAILURE"
        And the "~stage@incomplete_fail:teardown" job is started
        And the "c" job on branch "stageFail2" is not started
        And the "target" job on branch "stageFail2" is not started

    Scenario: Downstream builds are triggered if required stage is successful.
        Given an existing pipeline on branch "stageSuccess1" with stage "simple_success" with the workflow jobs:
        | job       | requires      |
        | b    | a  |
        | c    | b  |
        | target    | ~stage@simple_success:teardown  |
        When the "hub" job on branch "stageSuccess1" is started
        And the "hub" build succeeded
        And the "a" job is triggered and succeeds
        And the "b" job is triggered and succeeds
        And the "c" job is triggered and succeeds
        Then the "~stage@simple_success" stageBuild status is "SUCCESS"
        And the "~stage@simple_success:teardown" job is started
        And the "target" job is triggered and succeeds
