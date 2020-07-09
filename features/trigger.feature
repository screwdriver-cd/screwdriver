@trigger
Feature: Remote Trigger

    Users should be allowed to tie together workflows from different build pipelines so that they can
    express dependencies between otherwise unrelated projects.

    Eg: The following combined pipeline workflows:
        (~commit) -> (success_A) -> (success_B)

        (fail_A) -> (fail_B)

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

    Scenario: External builds are not triggered if required build is not successful.
        Given an existing pipeline on branch "pipelineA" with job "fail_A"
        And an existing pipeline on branch "pipelineB" with the workflow jobs:
            | job           | requires      |
            | fail_B | ~sd@?:fail_A |
        When the "fail_A" job on branch "pipelineA" is started
        And the "fail_A" build failed
        Then the "fail_B" job on branch "pipelineB" is not triggered

    Scenario: External build is triggered after another build is successful.
        Given an existing pipeline on branch "pipelineA" with job "success_A"
        And an existing pipeline on branch "pipelineB" with the workflow jobs:
            | job           | requires      |
            | success_B | ~sd@?:success_A |
        When the "success_A" job on branch "pipelineA" is started
        And the "success_A" build succeeded
        Then the "success_B" job on branch "pipelineB" is started
        And the "success_B" build's parentBuildId on branch "pipelineB" is that "success_A" build's buildId

    Scenario: Fan-out. Multiple external builds are triggered in parallel as a result of a build's success.
        Given an existing pipeline on branch "pipelineA" with job "parallel_A"
        And an existing pipeline on branch "pipelineB" with the workflow jobs:
            | job             | requires      |
            | parallel_B1 | ~sd@?:parallel_A |
            | parallel_B2 | ~sd@?:parallel_A |
        When the "parallel_A" job on branch "pipelineA" is started
        And the "parallel_A" build succeeded
        Then the "parallel_B1" job on branch "pipelineB" is started
        And the "parallel_B1" build's parentBuildId on branch "pipelineB" is that "parallel_A" build's buildId
        And the "parallel_B2" job on branch "pipelineB" is started
        And the "parallel_B2" build's parentBuildId on branch "pipelineB" is that "parallel_A" build's buildId
        And builds for "parallel_B1" and "parallel_B2" jobs are part of a single event

    Scenario: Remote Join
        Given an existing pipeline on branch "remote1" with the workflow jobs:
            | job       | requires                  |
            | simple    | ~commit                   |
            | parallel  | simple                    |
            | join      | parallel, sd@?:external   |
        And an existing pipeline on branch "remote2" with the workflow jobs:
            | job       | requires      |
            | external  | ~sd@?:simple  |
        When a new commit is pushed to "remote1" branch
        And the "simple" job is triggered on branch "remote1"
        And the "simple" build succeeded
        And the "parallel" job is triggered on branch "remote1"
        And the "parallel" build succeeded
        And the "external" build's parentBuildId on branch "remote2" is that "simple" build's buildId
        And the "external" build succeeded
        Then the "join" job is triggered from "parallel" on branch "remote1" and "external" on branch "remote2"
        And that "join" build uses the same SHA as the "simple" build on branch "remote1"

    Scenario: Join Job from External Trigger
        Given an existing pipeline on branch "remoteA" with the workflow jobs:
            | job       | requires  |
            | trigger   | ~commit   |
        And an existing pipeline on branch "remoteB" with the workflow jobs:
            | job       | requires              |
            | main      | ~sd@?:trigger         |
            | parallel1 | main                  |
            | parallel2 | main                  |
            | join      | parallel1, parallel2  |
        When a new commit is pushed to "remoteA" branch
        And the "trigger" job is triggered on branch "remoteA"
        And the "trigger" build succeeded
        And the "main" build's parentBuildId on branch "remoteB" is that "trigger" build's buildId
        And the "main" build succeeded
        And the "parallel1" build's parentBuildId on branch "remoteB" is that "main" build's buildId
        And the "parallel1" build succeeded
        And the "parallel2" build's parentBuildId on branch "remoteB" is that "main" build's buildId
        And the "parallel2" build succeeded
        Then the "join" job is triggered from "parallel1" and "parallel2" on branch "remoteB"
        And that "join" build uses the same SHA as the "main" build on branch "remoteB"