@trigger
Feature: Remote Trigger

    Users should be allowed to tie together workflows from different build pipelines so that they can
    express dependencies between otherwise unrelated projects.

    Eg: The following combined pipeline workflows:
        (~commit) -> (success_A_*) -> (success_B_*)

        (fail_A) -> (fail_B_*)

                        (parallel_B1)
        (parallel_A) ->
                        (parallel_B2)



        Assume Pipeline B generally depends on Pipeline A. A user should be able to build Pipeline B
        when Pipeline A has been built. A user can also make it specific to a job so that
        Pipeline B -> (success_B) to be built when Pipeline A -> (success_A) is
        finished successfully.

    Rules:
        - Configuration for trigger must reside in Workflow/Job being triggered
        - Triggered workflow/job should start with latest commit on configured SCM branch
        - If multiple jobs in a pipeline requires the same external pipeline's Job as trigger, then
          builds for these jobs should be part of same pipeline event

    @prod
    Scenario: External builds are not triggered if required build is not successful.
        Given an existing pipeline on branch "pipelineA" with job "fail_A"
        And an existing pipeline on branch "pipelineB" with the workflow jobs:
            | job         | requires      |
            | fail_B_prod | ~sd@?:fail_A  |
        When the "fail_A" job on branch "pipelineA" is started
        And the "fail_A" build failed
        Then the "fail_B_prod" job on branch "pipelineB" is not triggered

    @beta
    Scenario: External builds are not triggered if required build is not successful.
        Given an existing pipeline on branch "pipelineA" with job "fail_A"
        And an existing pipeline on branch "pipelineB" with the workflow jobs:
            | job         | requires      |
            | fail_B_beta | ~sd@?:fail_A  |
        When the "fail_A" job on branch "pipelineA" is started
        And the "fail_A" build failed
        Then the "fail_B_beta" job on branch "pipelineB" is not triggered

    @prod
    Scenario: External build is triggered after another build is successful.
        Given an existing pipeline on branch "pipelineA" with job "success_A"
        And an existing pipeline on branch "pipelineB" with the workflow jobs:
            | job               | requires        |
            | success_B_or_prod | ~sd@?:success_A |
        When the "success_A" job on branch "pipelineA" is started
        And the "success_A" build succeeded
        Then the "success_B_or_prod" job on branch "pipelineB" is started
        And the "success_B_or_prod" build's parentBuildId on branch "pipelineB" is that "success_A" build's buildId

    @beta
    Scenario: External build is triggered after another build is successful.
        Given an existing pipeline on branch "pipelineA" with job "success_A"
        And an existing pipeline on branch "pipelineB" with the workflow jobs:
            | job                | requires        |
            | success_B_and_beta | ~sd@?:success_A |
        When the "success_A" job on branch "pipelineA" is started
        And the "success_A" build succeeded
        Then the "success_B_or_beta" job on branch "pipelineB" is started
        And the "success_B_or_beta" build's parentBuildId on branch "pipelineB" is that "success_A" build's buildId

    @prod
    Scenario: External build is triggered after one of the builds is successful.
        Given an existing pipeline on branch "pipelineA" with job "success_A"
        And an existing pipeline on branch "pipelineB" with the workflow jobs:
            | job                | requires                         |
            | or_multiple_B_prod | ~sd@?:success_A, ~sd@?:fail_A    |
        When the "success_A" job on branch "pipelineA" is started
        And the "success_A" build succeeded
        Then the "or_multiple_B_prod" job on branch "pipelineB" is started
        And the "or_multiple_B_prod" build's parentBuildId on branch "pipelineB" is that "success_A" build's buildId

    @beta
    Scenario: External build is triggered after one of the builds is successful.
        Given an existing pipeline on branch "pipelineA" with job "success_A"
        And an existing pipeline on branch "pipelineB" with the workflow jobs:
            | job                | requires                         |
            | or_multiple_B_beta | ~sd@?:success_A, ~sd@?:fail_A |
        When the "success_A" job on branch "pipelineA" is started
        And the "success_A" build succeeded
        Then the "or_multiple_B_beta" job on branch "pipelineB" is started
        And the "or_multiple_B_beta" build's parentBuildId on branch "pipelineB" is that "success_A" build's buildId

    @ignore
    @prod
    Scenario: External build which requires single AND trigger is triggered after another build is successful.
        Given an existing pipeline on branch "pipelineA" with job "success_A"
        And an existing pipeline on branch "pipelineB" with the workflow jobs:
            | job                | requires       |
            | success_B_and_prod | sd@?:success_A |
        When the "success_A" job on branch "pipelineA" is started
        And the "success_A" build succeeded
        Then the "success_B_and_prod" job on branch "pipelineB" is triggered
        And the "success_B_and_prod" build's parentBuildId on branch "pipelineB" is that "success_A" build's buildId

    @ignore
    @beta
    Scenario: External build which requires single AND trigger is triggered after another build is successful.
        Given an existing pipeline on branch "pipelineA" with job "success_A"
        And an existing pipeline on branch "pipelineB" with the workflow jobs:
            | job                | requires       |
            | success_B_and_beta | sd@?:success_A |
        When the "success_A" job on branch "pipelineA" is started
        And the "success_A" build succeeded
        Then the "success_B_and_beta" job on branch "pipelineB" is triggered
        And the "success_B_and_beta" build's parentBuildId on branch "pipelineB" is that "success_A" build's buildId

    Scenario: Fan-out. Multiple external builds are triggered in parallel as a result of a build's success.
        Given an existing pipeline on branch "pipelineA" with job "parallel_A"
        And an existing pipeline on branch "pipelineB" with the workflow jobs:
            | job           | requires          |
            | parallel_B1   | ~sd@?:parallel_A  |
            | parallel_B2   | ~sd@?:parallel_A  |
        When the "parallel_A" job on branch "pipelineA" is started
        And the "parallel_A" build succeeded
        Then the "parallel_B1" job on branch "pipelineB" is started
        And the "parallel_B1" build's parentBuildId on branch "pipelineB" is that "parallel_A" build's buildId
        And the "parallel_B2" job on branch "pipelineB" is started
        And the "parallel_B2" build's parentBuildId on branch "pipelineB" is that "parallel_A" build's buildId
        And builds for "parallel_B1" and "parallel_B2" jobs are part of a single event

    @beta
    Scenario: Remote Join
        Given an existing pipeline on branch "beta-remote_join1" with the workflow jobs:
            | job       | requires                  |
            | simple    | ~commit                   |
            | parallel  | simple                    |
            | join      | parallel, sd@?:external   |
        And an existing pipeline on branch "beta-remote_join2" with the workflow jobs:
            | job       | requires      |
            | external  | ~sd@?:simple  |
        When a new commit is pushed to "beta-remote_join1" branch with the trigger jobs
        And the "simple" job is triggered on branch "beta-remote_join1"
        And the "simple" build succeeded
        And the "parallel" job is triggered on branch "beta-remote_join1"
        And the "parallel" build succeeded
        And the "external" build's parentBuildId on branch "beta-remote_join2" is that "simple" build's buildId
        And the "external" build succeeded
        Then the "join" job is triggered from "parallel" on branch "beta-remote_join1" and "external" on branch "beta-remote_join2"
        And that "join" build uses the same SHA as the "simple" build on branch "beta-remote_join1"

    @prod
    Scenario: Remote Join
        Given an existing pipeline on branch "remote_join1" with the workflow jobs:
            | job       | requires                  |
            | simple    | ~commit                   |
            | parallel  | simple                    |
            | join      | parallel, sd@?:external   |
        And an existing pipeline on branch "remote_join2" with the workflow jobs:
            | job       | requires      |
            | external  | ~sd@?:simple  |
        When a new commit is pushed to "remote_join1" branch with the trigger jobs
        And the "simple" job is triggered on branch "remote_join1"
        And the "simple" build succeeded
        And the "parallel" job is triggered on branch "remote_join1"
        And the "parallel" build succeeded
        And the "external" build's parentBuildId on branch "remote_join2" is that "simple" build's buildId
        And the "external" build succeeded
        Then the "join" job is triggered from "parallel" on branch "remote_join1" and "external" on branch "remote_join2"
        And that "join" build uses the same SHA as the "simple" build on branch "remote_join1"

    @prod
    Scenario: Join Job from External Trigger
        Given an existing pipeline on branch "external_trigger1" with the workflow jobs:
            | job       | requires  |
            | trigger   | ~commit   |
        And an existing pipeline on branch "external_trigger2" with the workflow jobs:
            | job       | requires              |
            | main      | ~sd@?:trigger         |
            | parallel1 | main                  |
            | parallel2 | main                  |
            | join      | parallel1, parallel2  |
        When a new commit is pushed to "external_trigger1" branch with the trigger jobs
        And the "trigger" job is triggered on branch "external_trigger1"
        And the "trigger" build succeeded
        And the "main" build's parentBuildId on branch "external_trigger2" is that "trigger" build's buildId
        And the "main" build succeeded
        And the "parallel1" build's parentBuildId on branch "external_trigger2" is that "main" build's buildId
        And the "parallel1" build succeeded
        And the "parallel2" build's parentBuildId on branch "external_trigger2" is that "main" build's buildId
        And the "parallel2" build succeeded
        Then the "join" job is triggered from "parallel1" and "parallel2" on branch "external_trigger2"
        And that "join" build uses the same SHA as the "main" build on branch "external_trigger2"

    @sourcePath
    Scenario: sourcePath
      Given an existing pipeline on branch "master" with the workflow jobs:
            | job       | requires  |
            | job1      | ~commit   |
            | job2      | ~commit   |
      When a new file is added to the "directory1" directory of the "master" branch
      Then a new build from "job1" should be created to test that change
      And a new build from "job2" should not be created to test that change

    @sourceDirectory
    Scenario: sourceDirectory
      Given an existing pipeline on branch "master" setting source directory "directory1" with the workflow jobs:
            | job       | requires  |
            | job1      | ~commit   |
      When a new file is added to the "directory1" directory of the "master" branch
      Then a new build from "job1" should be created to test that change

    @require-or
    Scenario: SINGLE OR FAIL
        Given an existing pipeline on branch "master" with the workflow jobs:
            | job        | requires |
            | FAIL       |          |
            | AFTER-FAIL | ~FAIL    |
        When start "FAIL" job
        And the "FAIL" build failed
        Then the "AFTER-FAIL" job is not triggered

    @require-or
    Scenario: MULTIPLE OR
        Given an existing pipeline on branch "master" with the workflow jobs:
            | job       | requires               |
            | PARALLEL1 |                        |
            | PARALLEL2 |                        |
            | MULTIPLE  | ~PARALLEL1, ~PARALLEL2 |
        When start "PARALLEL1" job
        And the "PARALLEL1" build succeeded
        And the "MULTIPLE" job is triggered
        Then that "MULTIPLE" build uses the same SHA as the "PARALLEL1" build
        When start "PARALLEL2" job
        And the "PARALLEL2" build succeeded
        And the "MULTIPLE" job is triggered
        Then that "MULTIPLE" build uses the same SHA as the "PARALLEL2" build

    @require-or
    Scenario: MULTIPLE OR ONCE
        Given an existing pipeline on branch "master" with the workflow jobs:
            | job            | requires               |
            | SIMPLE         | ~commit                |
            | PARALLEL1      | ~SIMPLE                |
            | PARALLEL2      | ~SIMPLE                |
            | MULTIPLE       | ~PARALLEL1, ~PARALLEL2 |
        When start "SIMPLE" job
        And the "SIMPLE" build succeeded
        And the "PARALLEL1" job is triggered from "SIMPLE"
        And the "PARALLEL1" build succeeded
        And the "PARALLEL2" job is triggered from "SIMPLE"
        And the "PARALLEL2" build succeeded
        Then the "MULTIPLE" job is triggered once
