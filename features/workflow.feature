@workflow
Feature: Workflow

    The primary part of the continuous delivery process is the ability to go from commit to
    production. This usually involves multiple environments and different levels of testing.
    For most projects, this is a simple linear graph:
        (main) -> (staging) -> (prod)

    However for others this can significantly more complex (but still a one-directional graph):
       (main) -> (staging) -> (integration) -> (10% bucket) -> (50% colo 1) -> (100% colo 1)
              -> (performance) -^                           -> (50% colo 2) -> (100% colo 2)

    Screwdriver needs to support both of these use-cases with similar ease.

    Rules:
        - Workflows must be one-directional (no loops)
        - All subsequent jobs must checkout from the same SHA as the previous job
    @ignore
    Scenario: Failure
        Given an existing pipeline with the workflow:
            | job           | requires  |
            | FAIL          | ~commit   |
            | AFTER-FAIL    | FAIL      |
        When the "FAIL" job is started
        And the build failed
        Then the "AFTER-FAIL" job is not started

    @ignore
    Scenario: Serially
        Given an existing pipeline with the workflow:
            | job       | requires  |
            | SIMPLE    | ~commit   |
            | PARALLEL1 | SIMPLE    |
        When the "SIMPLE" job is started
        And the build succeeded
        Then the "PARALLEL1" job is started
        And that "PARALLEL1" build uses the same SHA as the "SIMPLE" build

    @ignore
    Scenario: Parallel
        Given an existing pipeline with the workflow:
            | job       | requires  |
            | SIMPLE    | ~commit   |
            | PARALLEL1 | SIMPLE    |
            | PARALLEL2 | SIMPLE    |
        When the "SIMPLE" job is started
        And the build succeeded
        Then the "PARALLEL1" job is started
        And the "PARALLEL2" job is started
        And that "PARALLEL1" build uses the same SHA as the "SIMPLE" build
        And that "PARALLEL2" build uses the same SHA as the "SIMPLE" build

    @ignore
    Scenario: Join
        Given an existing pipeline with the workflow:
            | job       | requires              |
            | SIMPLE    | ~commit               |
            | PARALLEL1 | SIMPLE                |
            | PARALLEL2 | SIMPLE                |
            | JOIN      | PARALLEL1, PARALLEL2  |
        When the "SIMPLE" job is started
        And the "SIMPLE" build succeeded
        And the "PARALLEL1" job is started
        And the "PARALLEL2" job is started
        Then the "JOIN" job is not started
        And the "PARALLEL1" build succeeded
        And the "PARALLEL2" build succeeded
        Then the "JOIN" job is started
        And that "JOIN" build uses the same SHA as the "SIMPLE" build

    Scenario: Branch filtering (the master branch is committed)
        Given an existing pipeline with the workflow:
            | job       | requires          |
            | SIMPLE    | ~commit           |
            | STAGING   | ~commit:staging   |
            | REGEX     | ~commit:/^.*$/    |
        When a new commit is pushed
        And it is on the "master" branch
        Then the "SIMPLE" job is started
        And the "STAGING" job is not started
        And the "REGEX" job is started
        And that "REGEX" build uses the same SHA as the "SIMPLE" build

    Scenario: Branch filtering (the staging branch is committed)
        Given an existing pipeline with the workflow:
            | job       | requires          |
            | SIMPLE    | ~commit           |
            | STAGING   | ~commit:staging   |
            | REGEX     | ~commit:/^.*$/    |
        When a new commit is pushed
        And it is on the "staging" branch
        Then the "SIMPLE" job is not started
        And the "STAGING" job is started
        And the "REGEX" job is started
        And that "REGEX" build uses the same SHA as the "STAGING" build

    Scenario: Branch filtering (a pull request is opened to the master branch)
        Given an existing pipeline with the workflow:
            | job       | requires      |
            | SIMPLE    | ~pr           |
            | STAGING   | ~pr:staging   |
            | REGEX     | ~pr:/^.*$/    |
            | MASTER-PR | ~pr:master    |
        When a pull request is opened
        And it is on the "master" branch
        Then the "SIMPLE" job is started
        And the "STAGINNG" job is not started
        And the "REGEX" job is started
        And the "MASTER-Pr" job is started
        And that "REGEX" and "MASTER-PR" build uses the same SHA as the "SIMPLE" build

    Scenario: Branch filtering (pr and filtered pr workflow)
        Given an existing pipeline with the workflow:
            | job               | requires      |
            | SIMPLE            | ~pr           |
            | PARALLEL1         | SIMPLE        |
            | MASTER-PR         | ~pr:master    |
            | AFTER-MASTER-PR   | MASTER-PR     |
        When a pull request is opened
        And it is on the "master" branch
        Then the "SIMPLE" job is started
        And the "MASTER-PR" job is started
        And that "MASTER-PR" build uses the same SHA as the "SIMPLE" build
        Then the "SIMPLE" job is succeeded
        And the "MASTER-PR" job is succeeded
        Then the "PARALLEL1" job is not started
        And the "AFTER-MASTER-PR" job is started
        And that "AFTER-MASTER-PR" build uses the same SHA as the "SIMPLE" build

    Scenario: Branch filtering (a pull request is opened to the staging branch)
        Given an existing pipeline with the workflow:
            | job       | requires      |
            | SIMPLE    | ~pr           |
            | STAGING   | ~pr:staging   |
            | REGEX     | ~pr:/^.*$/    |
            | MASTER-PR | ~pr:master    |
        When a pull request is opened
        And it is on the "staging" branch
        Then the "SIMPLE" job is not started
        And the "STAGING" job is started
        And the "REGEX" job is started
        And the "MASTER-PR" job is not started
        And that "REGEX" build uses the same SHA as the "STAGING" build
