Feature: Remote Trigger

    Users should be allowed to tie together workflows from different build pipelines so that they can
    express dependencies between otherwise unrelated projects.

    Eg: Pipeline A for Project Foo
        (~commit) -> (build_foo) -> (deploy_foo)
        (deploy_foo_fail)
        Pipeline B for Project Bar
        (~commit) -> (build_bar) -> (deploy_bar)
        (build_bar_fail)

        Assume Project Bar depends on Project Foo. A user should be able to build Project Bar
        when Project Foo has been built. A user can also make it specific to a job so that
        Project Bar -> (build_bar) to be built when Project Foo -> (deploy_foo) is
        finished successfully.

        Combined Pipeline Workflows
        (~commit) -> (build_foo) -> (deploy_foo) -> (build_bar) -> (deploy_bar)
        (deploy_foo_fail) -> (build_bar_fail)

    Rules:
        - Configuration for trigger must reside in Workflow/Job being triggered
        - Triggered workflow/job should start with latest commit on configured SCM branch.
        - If multiple jobs in a pipeline requires the same external pipeline's Job as trigger, then
          builds for these jobs should be part of same pipeline event.

    Scenario: Builds are not triggered if required build is not successful.
        Given two pipelines "pipelineA" and "pipelineB" with following config:
            | job           | requires      |
            | pipelineB:build_bar_fail | pipelineA:deploy_foo_fail |
        When the "deploy_foo_fail" job in pipelineA is started
        And the "deploy_foo_fail" build failed
        Then the "build_bar_fail" job in pipelineB is not triggered

    Scenario: Build is triggered after another build is successful.
        Given two pipelines "pipelineA" and "pipelineB" with following config:
            | job           | requires      |
            | pipelineB:build_bar | pipelineA:deploy_foo |
        When the "deploy_foo" job in pipelineA is started
        And the "deploy_foo" build succeeded
        Then the "build_bar" job in pipelineB is started
        And that "build_bar" build's parentBuildId is that "deploy_foo" build's buildId

    @ignore
    Scenario: Fan-out. Multiple builds are triggered in parallel as a result of a build's success.
        Given two pipelines "pipelineA" and "pipelineB" with following config:
            | job             | requires      |
            | pipelineB:build_bar   | pipelineA:deploy_foo |
            | pipelineB:build_deploy | pipelineA:deploy_foo |
        When the "deploy_foo" job in pipelineA is started
        And the "deploy_foo" build succeeded
        Then the build for "build_bar" job in pipelineB is started
        And that "build_bar" build uses the same SHA as latest commit on the branch pipeline is configured
        And the build for "build_deploy" job in pipelineB is started
        And that "build_deploy" build uses the same SHA as latest commit on the branch pipeline is configured
        And builds for "build_bar" and "build_deploy" jobs are part of one single event.
