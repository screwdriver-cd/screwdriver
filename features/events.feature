@events
@parallel
Feature: Events

    The most straight-forward change to a pipeline is by committing code. It has
    a unique identifier, a committer (user), a notification (webhooks), and a way
    to discover more detail (GitHub or Bitbucket). However, this is not the only
    type of change that can affect a pipeline. There is another less visible change.
    For example: upstream dependency (container, packages, testing service, etc.)
    This type of change has no standardized identifier, no direct author, is not
    easily detected, and has little to no detail.

    Imagine a pipeline with four jobs:
    main -> publish -> stage -> prod

    Even if the SHA1 doesn't change, a user can potentially re-run the main job
    each hour and get a different outcome as the packages or container could get
    updates. This is why tracking change in a pipeline by commits is inconsistent.

    Instead, Screwdriver should provide a higher abstraction, an event, that
    represents either a commit or a manual restart (for now).

    Rules:
    - Events should provide enough context to viewers about what change they
    represent (sha1, commit message, author, user who restarted, timestamp, etc.)
    - Events should know which builds are because of them
    - Pipeline View should list events not commits

    Background:
        Given an existing pipeline with the workflow:
            | job | triggers |
            | main | publish |
        And "calvin" has admin permission to the pipeline

    Scenario: Create an event when user starts a job
        And "calvin" is logged in
        When the "main" job is started
        Then an event is created
        And the "main" build succeeds
        And the "publish" build succeeds with the same eventId as the "main" build

    Scenario: Create an event from the previous event when user restarts a job
        And "calvin" is logged in
        And the "main" job has a previous event
        When the "main" job is restarted
        Then an event is created with the parent event which is same as the previous event
        And the "main" build succeeds
        And the "publish" build succeeds with the same eventId as the "main" build

    @ignore
    Scenario: Create an event when a PR is opened
        When a pull request is opened
        And the "main" job is started
        Then an event is created
        And the "main" build is created

    @ignore
    Scenario: Create an event when a PR is synced
        When a pull request is synced
        And the "main" job is started
        Then an event is created
        And the "main" build is created

    @ignore
    Scenario: Create an event when a PR is merged
        When a pull request is merged
        And the "main" job is started
        Then an event is created
        And the "main" build is created
