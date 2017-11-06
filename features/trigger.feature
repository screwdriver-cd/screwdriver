@ignore
Feature: Trigger

    Users should be allowed to tie together workflows from different build pipelines so that they can
    express dependencies between otherwise unrelated projects.

    Eg: PipeLine A for Project Foo
        (~commit) -> (build_foo) -> (deploy_foo)
        Pipeline B for Project Bar
        (~commit) -> (build_bar) -> (deploy_bar)

        Assume Project Bar depends on Project Foo. A user should be able to build Project Bar
        when Project Foo has been built. A user can also make it specific to a job so that
        Project Bar -> (build_bar) to be built when Project Foo -> (deploy_foo) is
        finished successfully.

        Combined Pipeline Workflow
        (~commit) -> (build_foo) -> (deploy_foo) -> Foo (build_bar) -> (deploy_bar)

    Rules:
        - Connected Workflows must be one-directional (no loops)
        - Configuration for trigger must reside in Workflow/Job being triggered
        - Triggered workflow/job should start with latest commit on configured SCM branch.
        - If multiple jobs in a pipeline requires the same external pipeline's Job as trigger, then
          builds for these jobs should be part of same pipeline event.

    Scenario: Failure
        Given two pipelines PipelineA and PipelineB with following config
            | job           | requires      |
            | PipelineB:BAR | PipelineA:FOO |
        When the "FOO" job in PiplelineA is started
        And the build failed
        Then the "BAR" job in PipelineB is not started

    Scenario: Success
        Given two pipelines PipelineA and PipelineB with following config
            | job           | requires      |
            | PipelineB:BAR | PipelineA:FOO |
        When the "FOO" job in PiplelineA is started
        And the build succeeded
        Then the "BAR" job in PipelineB is started
        And that "BAR" build uses the same SHA as latest commit on the branch pipeline is configured

    Scenario: Multiple
        Given two pipelines PipelineA and PipelineB with following config
            | job             | requires      |
            | PipelineB:BAR   | PipelineA:FOO |
            | PipelineB:HELLO | PipelineA:FOO |
        When the "FOO" job in PiplelineA is started
        And the build succeeded
        Then the "BAR" job in PipelineB is started
        And that "BAR" build uses the same SHA as latest commit on the branch pipeline is configured
        And the "HELLO" job in PipelineB is started
        And that "HELLO" build uses the same SHA as latest commit on the branch pipeline is configured
