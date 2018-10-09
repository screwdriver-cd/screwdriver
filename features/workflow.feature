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

    Scenario: Serially
        Given an existing pipeline on "serially" branch with the workflow jobs:
            | job       | requires  |
            | SIMPLE    | ~commit   |
            | PARALLEL1 | SIMPLE    |
        When a new commit is pushed to "serially" branch
        Then the "SIMPLE" job is triggered
        And the "SIMPLE" build succeeded
        Then the "PARALLEL1" job is triggered from "SIMPLE"
        And that "PARALLEL1" build uses the same SHA as the "SIMPLE" build

    Scenario: Failure
        Given an existing pipeline on "failure" branch with the workflow jobs:
            | job           | requires  |
            | FAIL          | ~commit   |
            | AFTER-FAIL    | FAIL      |
        When a new commit is pushed to "failure" branch
        Then the "FAIL" job is triggered
        And the "FAIL" build failed
        Then the "AFTER-FAIL" job is not triggered

    Scenario: Parallel
        Given an existing pipeline on "parallel" branch with the workflow jobs:
            | job       | requires  |
            | SIMPLE    | ~commit   |
            | PARALLEL1 | SIMPLE    |
            | PARALLEL2 | SIMPLE    |
        When a new commit is pushed to "parallel" branch
        And the "SIMPLE" job is triggered
        And the "SIMPLE" build succeeded
        Then the "PARALLEL1" job is triggered from "SIMPLE"
        And the "PARALLEL2" job is triggered from "SIMPLE"
        And that "PARALLEL1" build uses the same SHA as the "SIMPLE" build
        And that "PARALLEL2" build uses the same SHA as the "SIMPLE" build
        And the "STAGING" job is not triggered
        And that "REGEX" build uses the same SHA as the "SIMPLE" build

    Scenario: Join
        Given an existing pipeline on "join" branch with the workflow jobs:
            | job       | requires              |
            | SIMPLE    | ~commit               |
            | PARALLEL1 | SIMPLE                |
            | PARALLEL2 | SIMPLE                |
            | JOIN      | PARALLEL1, PARALLEL2  |
        When a new commit is pushed to "join" branch
        And the "SIMPLE" job is triggered
        And the "SIMPLE" build succeeded
        And the "PARALLEL1" job is triggered from "SIMPLE"
        And the "PARALLEL1" build succeeded
        And the "PARALLEL2" job is triggered from "SIMPLE"
        And the "PARALLEL2" build succeeded
        Then the "JOIN" job is triggered from "PARALLEL1" and "PARALLEL2"
        And that "JOIN" build uses the same SHA as the "SIMPLE" build

    Scenario: Branch filtering (the master branch is committed)
        Given an existing pipeline on "master" branch with the workflow jobs:
            | job       | requires          |
            | SIMPLE    | ~commit           |
            | STAGING   | ~commit:staging   |
            | REGEX     | ~commit:/^.*$/    |
        When a new commit is pushed to "master" branch
        Then the "SIMPLE" job is triggered
        And the "REGEX" job is triggered

    Scenario: Branch filtering (the staging branch is committed)
        Given an existing pipeline on "master" branch with the workflow jobs:
            | job       | requires          |
            | SIMPLE    | ~commit           |
            | STAGING   | ~commit:staging   |
            | REGEX     | ~commit:/^.*$/    |
        When a new commit is pushed to "staging" branch
        Then the "STAGING" job is triggered
        And the "REGEX" job is triggered
        And the "SIMPLE" job is not triggered
        And that "REGEX" build uses the same SHA as the "STAGING" build

    @ignore
    Scenario: Branch filtering (a pull request is opened to the master branch)
        Given an existing pipeline on "master" branch with the workflow jobs:
            | job       | requires      |
            | SIMPLE    | ~pr           |
            | STAGING   | ~pr:staging   |
            | REGEX     | ~pr:/^.*$/    |
            | MASTER-PR | ~pr:master    |
        When a pull request is opened to "master" branch
        Then the "SIMPLE" job is triggered
        And the "REGEX" job is triggered
        And the "MASTER-PR" job is triggered
        And the "STAGINNG" job is not triggered
        And that "REGEX" build uses the same SHA as the "SIMPLE" build
        And that "MASTER-PR" build uses the same SHA as the "SIMPLE" build

    @ignore
    Scenario: Branch filtering (pr and filtered pr workflow)
        Given an existing pipeline on "master" branch with the workflow jobs:
            | job               | requires      |
            | SIMPLE            | ~pr           |
            | PARALLEL1         | SIMPLE        |
            | MASTER-PR         | ~pr:master    |
            | AFTER-MASTER-PR   | MASTER-PR     |
        When a pull request is opened to "master" branch
        Then the "SIMPLE" job is triggered
        And the "MASTER-PR" job is triggered
        And that "MASTER-PR" build uses the same SHA as the "SIMPLE" build
        Then the "SIMPLE" build succeeded
        And the "MASTER-PR" build succeeded
        Then the "PARALLEL1" job is not triggered
        And the "AFTER-MASTER-PR" job is triggered from "MASTER-PR"
        And that "AFTER-MASTER-PR" build uses the same SHA as the "SIMPLE" build

    @ignore
    Scenario: Branch filtering (a pull request is opened to the staging branch)
        Given an existing pipeline on "master" branch with the workflow jobs:
            | job       | requires      |
            | SIMPLE    | ~pr           |
            | STAGING   | ~pr:staging   |
            | REGEX     | ~pr:/^.*$/    |
            | MASTER-PR | ~pr:master    |
        When a pull request is opened to staging branch
        Then the "STAGING" job is triggered
        And the "REGEX" job is triggered
        And the "SIMPLE" job is not triggered
        And the "MASTER-PR" job is not triggered
        And that "REGEX" build uses the same SHA as the "STAGING" build
