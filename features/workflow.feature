@workflow
@parallel
@x1
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

    Scenario: Join Failure
        Given an existing pipeline on "failure" branch with the workflow jobs:
            | job             | requires     |
            | SIMPLE          | ~commit      |
            | FAIL            | ~commit      |
            | AFTER-FAIL-JOIN | SIMPLE, FAIL |
        When a new commit is pushed to "failure" branch
        Then the "SIMPLE" job is triggered
        Then the "SIMPLE" build succeeded
        Then the "FAIL" job is triggered
        Then the "FAIL" build failed
        Then the "AFTER-FAIL-JOIN" job is not triggered

    Scenario: Branch filtering (the master branch is committed)
        Given an existing pipeline on "master" branch with the workflow jobs:
            | job           | requires              |
            | SIMPLE        | ~commit               |
            | STAGING       | ~commit:staging       |
            | REGEX         | ~commit:/^.*$/        |
            | UNMATCH-REGEX | ~commit:/^unmatch$/   |
        When a new commit is pushed to "master" branch
        Then the "SIMPLE" job is triggered
        And the "REGEX" job is triggered
        And the "STAGING" job is not triggered
        And the "UNMATCH-REGEX" job is not triggered
        And that "REGEX" build uses the same SHA as the "SIMPLE" build

    Scenario: Branch filtering (the staging branch is committed)
        Given an existing pipeline on "master" branch with the workflow jobs:
            | job           | requires              |
            | SIMPLE        | ~commit               |
            | STAGING       | ~commit:staging       |
            | REGEX         | ~commit:/^.*$/        |
            | UNMATCH-REGEX | ~commit:/^unmatch$/   |
        When a new commit is pushed to "staging" branch
        Then the "STAGING" job is triggered
        And the "REGEX" job is triggered
        And the "SIMPLE" job is not triggered
        And the "UNMATCH-REGEX" job is not triggered
        And that "REGEX" build uses the same SHA as the "STAGING" build

    @workflow-chainPR
    @ignore
    Scenario: chainPR
        Given an existing pipeline on "master" branch with the workflow jobs:
            | job          | requires  |
            | SIMPLE       | ~pr       |
            | AFTER-SIMPLE | SIMPLE    |
        When a pull request is opened from "testpr" branch
        Then the "SIMPLE" PR job is triggered
        And the "SIMPLE" PR build succeeded
        Then the PR job of "AFTER-SIMPLE" is triggered from PR job of "SIMPLE"
        And that "AFTER-SIMPLE" PR build uses the same SHA as the "SIMPLE" PR build
        And the "AFTER-SIMPLE" PR build succeeded

    @workflow
    @workflow-PR
    Scenario: Branch filtering (a pull request is opened to the master branch)
        Given an existing pipeline on "master" branch with the workflow jobs:
            | job               | requires          |
            | SIMPLE            | ~pr               |
            | STAGING           | ~pr:staging       |
            | REGEX             | ~pr:/^.*$/        |
            | UNMATCH-REGEX     | ~pr:/^unmatch$/   |
            | MASTER-PR         | ~pr:master        |
            | AFTER-MASTER-PR   | MASTER-PR         |
        When a pull request is opened to "master" branch
        Then the "SIMPLE" PR job is triggered
        And the "STAGING" PR job is not triggered
        And the "REGEX" PR job is triggered
        And the "UNMATCH-REGEX" PR job is not triggered
        And the "MASTER-PR" PR job is triggered
        And the "AFTER-MASTER-PR" PR job is not triggered
        And that "REGEX" PR build uses the same SHA as the "SIMPLE" PR build
        And that "MASTER-PR" PR build uses the same SHA as the "SIMPLE" PR build

    @workflow
    @workflow-PR
    Scenario: Branch filtering (a pull request is opened to the staging branch)
        Given an existing pipeline on "master" branch with the workflow jobs:
            | job           | requires          |
            | SIMPLE        | ~pr               |
            | STAGING       | ~pr:staging       |
            | REGEX         | ~pr:/^.*$/        |
            | UNMATCH-REGEX | ~pr:/^unmatch$/   |
            | MASTER-PR     | ~pr:master        |
        When a pull request is opened to "staging" branch
        Then the "STAGING" PR job is triggered
        And the "REGEX" PR job is triggered
        And the "UNMATCH-REGEX" PR job is not triggered
        And the "SIMPLE" PR job is not triggered
        And the "MASTER-PR" PR job is not triggered
        And that "REGEX" PR build uses the same SHA as the "STAGING" PR build
