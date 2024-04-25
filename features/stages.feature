@stage
Feature: Stage

    Users should be allowed to tie together jobs from the same pipeline so that they can
    convey the nature of the jobs in the workflow graph. They can either
    set setup and teardown jobs explicitly or it will be created implicitly as a virtual job.

    Eg: The following pipeline workflow:
        (~commit) -> (hub) -> (a) -> (b) -> (c) -> (target)

        Assume a, b, and c are part of a stage.

    Rules:
        - Users should be able to define pipeline stages, and add a job to a stage.
        - A job can belong to only one stage.
        - Relation between jobs will still be defined using requires.
        - Jobs with empty requires (requires:[]) indicate the start of a stage.
        - Setup and teardown jobs can be implicitly or explicitly created.
        - Teardown build should run when execution of any job in a stage is not successful; downstream jobs should not continue, and stageBuild should be updated accordingly.
        - Setup build should run before a stage.

    Scenario: Downstream builds are not triggered if required stage is not successful.
        Given an existing pipeline on branch "stageFail1" with the workflow jobs:
            | job       | requires      |
            | target    | stage@simple_fail:teardown  |
            | stage@simple_fail:setup | ~hub |
        And the pipeline has the following stages:
            | stage       | jobs   |
            | simple_fail   | a, b, c |
        When the "hub" job on branch "stageFail1" is started
        And the "hub" build succeeded
        And the "a" job is triggered
        And the "a" build succeeded
        And the "b" job is triggered
        And the "b" build succeeded
        And the "c" job is triggered
        And the "c" build failed
        Then the "stage@simple_fail" stageBuild status is "FAILURE"
        And the "stage@simple_fail:teardown" job is triggered
        And the "target" job is not triggered

    Scenario: Downstream builds within a stage are not triggered if upstream build in stage is not successful.
        Given an existing pipeline on branch "stageFail2" with the workflow jobs:
            | job       | requires      |
            | target    | stage@incomplete_fail:teardown  |
            | stage@incomplete_fail:setup | ~hub |
        And the pipeline has the following stages:
            | stage     | jobs           |
            | incomplete_fail | a, b, c |
        When the "hub" job on branch "stageFail2" is started
        And the "hub" build succeeded
        And the "a" job is triggered
        And the "a" build succeeded
        And the "b" job is triggered
        And the "b" build failed
        Then the "stage@incomplete_fail" stageBuild status is "FAILURE"
        And the "stage@incomplete_fail:teardown" job is triggered
        And the "c" job is not triggered
        And the "target" job is not triggered

    Scenario: Downstream builds are triggered if required stage is successful.
        Given an existing pipeline on branch "stageSuccess1" with the workflow jobs:
            | job       | requires      |
            | target    | stage@simple_success:teardown  |
            | stage@simple_success:setup | ~hub |
        And the pipeline has the following stages:
            | stage     | jobs           |
            | simple_success | a, b, c |
        When the "hub" job on branch "stageSuccess1" is started
        And the "hub" build succeeded
        And the "a" job is triggered
        And the "a" build succeeded
        And the "b" job is triggered
        And the "b" build succeeded
        And the "c" job is triggered
        And the "c" build succeeded
        Then the "stage@simple_success" stageBuild status is "SUCCESS"
        And the "stage@simple_success:teardown" job is triggered
        And the "target" job is triggered
        And the "target" build succeeded
