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
        And the "stage@simple_fail:teardown" build succeeded
        And the "stage@simple_fail" stageBuild status is "FAILURE"

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
        And the "stage@incomplete_fail:teardown" build succeeded
        And the "stage@incomplete_fail" stageBuild status is "FAILURE"

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
        And the "stage@simple_success:teardown" build succeeded
        And the "stage@simple_success" stageBuild status is "SUCCESS"

    Scenario: Downstream builds are not triggered if stage setup job is not successful.
        Given an existing pipeline on branch "setupFail" with the workflow jobs:
            | job       | requires      |
            | target    | stage@setup_fail:teardown  |
            | stage@setup_fail:setup | ~hub |
        And the pipeline has the following stages:
            | stage     | jobs           |
            | setup_fail | a, b, c |
        When the "hub" job on branch "setupFail" is started
        And the "hub" build succeeded
        And the "stage@setup_fail:setup" job is triggered
        And the "stage@setup_fail:setup" build failed
        Then the "stage@setup_fail" stageBuild status is "FAILURE"
        And the "stage@setup_fail:teardown" job is triggered
        And the "a" job is not triggered
        And the "target" job is not triggered
        And the "stage@setup_fail:teardown" build succeeded
        And the "stage@setup_fail" stageBuild status is "FAILURE"

    Scenario: Downstream builds are not triggered if stage teardown job is not successful.
        Given an existing pipeline on branch "teardownFail" with the workflow jobs:
            | job       | requires      |
            | target    | stage@teardown_fail:teardown  |
            | stage@teardown_fail:setup | ~hub |
        And the pipeline has the following stages:
            | stage       | jobs   |
            | teardown_fail   | a, b, c |
        When the "hub" job on branch "teardownFail" is started
        And the "hub" build succeeded
        And the "a" job is triggered
        And the "a" build succeeded
        And the "b" job is triggered
        And the "b" build succeeded
        And the "c" job is triggered
        And the "c" build succeeded
        And the "stage@teardown_fail:teardown" job is triggered
        And the "stage@teardown_fail:teardown" build failed
        And the "stage@teardown_fail" stageBuild status is "FAILURE"
        And the "target" job is not triggered

    Scenario: Downstream stage is triggered if required stage is successful.
        Given an existing pipeline on branch "twoStageSuccess" with the workflow jobs:
            | job       | requires      |
            | target    | stage@simple_success2:teardown  |
            | join-target    | stage@simple_success1:teardown, stage@simple_success2:teardown  |
            | stage@simple_success2:setup | stage@simple_success1:teardown  |
            | stage@simple_success1:setup | ~hub |
        And the pipeline has the following stages:
            | stage     | jobs           |
            | simple_success1 | a, b |
            | simple_success2 | c, d |
        When the "hub" job on branch "twoStageSuccess" is started
        And the "hub" build succeeded
        And the "a" job is triggered
        And the "a" build succeeded
        And the "b" job is triggered
        And the "b" build succeeded
        And the "stage@simple_success1:teardown" job is triggered
        Then the "stage@simple_success1" stageBuild status is "SUCCESS"
        And the "join-target" job is not triggered
        And the "c" job is triggered
        And the "c" build succeeded
        And the "d" job is triggered
        And the "d" build succeeded
        And the "stage@simple_success2:teardown" job is triggered
        And the "stage@simple_success2:teardown" build succeeded
        And the "stage@simple_success2" stageBuild status is "SUCCESS"
        And the "target" job is triggered
        And the "target" build succeeded
        And the "join-target" job is triggered
        And the "join-target" build succeeded

    Scenario: Stage setup, child jobs of setup and teardown are triggered in PR workflow
        Given an existing pipeline on branch "prStage" with the workflow jobs:
            | job       | requires      |
            | main      | ~pr  |
            | c         | a    |
            | d         | main    |
            | stage@simple:setup | ~pr |
            | e         | stage@simple:setup    |
            | f         | stage@simple:teardown |
        And the pipeline has the following stages:
            | stage     | jobs           |
            | simple | a, b, c |
        When a pull request is opened to "prStage" branch
        Then the "main" PR job is triggered
        And the "main" PR build succeeded
        And the "d" PR job is not triggered
        And the "stage@simple:setup" PR job is triggered
        And the "stage@simple:setup" PR build succeeded
        And the "a" PR build succeeded
        And the "b" PR build succeeded
        And the "c" PR job is not triggered
        And the "e" PR job is not triggered
        And the "stage@simple:teardown" PR job is triggered
        And the "stage@simple:teardown" PR build succeeded
        When the pipeline has the following PR stages:
            | stage     |
            | simple    |
        Then the "stage@simple" stageBuild status is "SUCCESS"
        And the "f" PR job is not triggered

    Scenario: All stage jobs are triggered in chained PR workflow
        Given an existing pipeline on branch "chainPRStage" with the workflow jobs:
            | job       | requires      |
            | main      | ~pr  |
            | c         | a    |
            | d         | main    |
            | stage@simple:setup | ~pr |
            | e         | stage@simple:setup    |
            | f         | stage@simple:teardown |
        And the pipeline has the following stages:
            | stage     | jobs           |
            | simple | a, b, c |
        When a pull request is opened to "chainPRStage" branch
        Then the "main" PR job is triggered
        And the "main" PR build succeeded
        And the "d" PR build succeeded
        And the "stage@simple:setup" PR job is triggered
        And the "stage@simple:setup" PR build succeeded
        And the "a" PR build succeeded
        And the "b" PR build succeeded
        And the "c" PR build succeeded
        And the "e" PR build succeeded
        And the "stage@simple:teardown" PR job is triggered
        And the "stage@simple:teardown" PR build succeeded
        When the pipeline has the following PR stages:
            | stage     |
            | simple    |
        Then the "stage@simple" stageBuild status is "SUCCESS"
        And the "f" PR build succeeded
