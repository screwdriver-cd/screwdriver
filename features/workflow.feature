@ignore
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

    Scenario: Failure
        Given an existing pipeline with the workflow:
            | job | requires |
            | FOO | ~commit  |
            | BAR | FOO      |
        When the "FOO" job is started
        And the build failed
        Then the "BAR" job is not started

    Scenario: Serially
        Given an existing pipeline with the workflow:
            | job | requires |
            | FOO | ~commit  |
            | BAR | FOO      |
        When the "FOO" job is started
        And the build succeeded
        Then the "BAR" job is started
        And that "BAR" build uses the same SHA as the "FOO" build

    Scenario: Parallel
        Given an existing pipeline with the workflow:
            | job | requires |
            | FOO | ~commit  |
            | BAR | FOO      |
            | BAZ | FOO      |
        When the "FOO" job is started
        And the build succeeded
        Then the "BAR" job is started
        And the "BAZ" job is started
        And that "BAR" build uses the same SHA as the "FOO" build
        And that "BAZ" build uses the same SHA as the "FOO" build

    Scenario: Join
        Given an existing pipeline with the workflow:
            | job   | requires |
            | FOO   | ~commit  |
            | BAR   | FOO      |
            | BAZ   | FOO      |
            | QUX   | BAR, BAZ |
        When the "FOO" job is started
        And the "FOO" build succeeded
        And the "BAR" job is started
        And the "BAZ" job is started
        Then the "QUX" job is not started
        And the "BAR" build succeeded
        And the "BAZ" build succeeded
        Then the "QUX" job is started
        And that "QUX" build uses the same SHA as the "FOO" build

    Scenario: Branch filtering (the master branch is committed)
        Given an existing pipeline with the workflow:
            | job   | requires        |
            | FOO   | ~commit         |
            | BAR   | ~commit:staging |
            | BAZ   | ~commit:/^.*$/  |
        When a new commit is pushed
        And it is on the "master" branch
        Then the "FOO" job is started
        And the "BAR" job is not started
        And the "BAZ" job is started
        And that "BAZ" build uses the same SHA as the "FOO" build

    Scenario: Branch filtering (the staging branch is committed)
        Given an existing pipeline with the workflow:
            | job   | requires        |
            | FOO   | ~commit         |
            | BAR   | ~commit:staging |
            | BAZ   | ~commit:/^.*$/  |
        When a new commit is pushed
        And it is on the "staging" branch
        Then the "FOO" job is not started
        And the "BAR" job is started
        And the "BAZ" job is started
        And that "BAZ" build uses the same SHA as the "BAR" build

    Scenario: Branch filtering (a pull request is opened to the master branch)
        Given an existing pipeline with the workflow:
            | job   | requires        |
            | FOO   | ~pr             |
            | BAR   | ~pr:staging     |
            | BAZ   | ~pr:/^.*$/      |
            | QUX   | ~pr:master      |
        When a pull request is opened
        And it is on the "master" branch
        Then the "FOO" job is started
        And the "BAR" job is not started
        And the "BAZ" job is started
        And the "QUX" job is started
        And that "BAZ" and "QUX" build uses the same SHA as the "FOO" build

    Scenario: Branch filtering (pr and filtered pr workflow)
        Given an existing pipeline with the workflow:
            | job   | requires        |
            | FOO   | ~pr             |
            | FOO2  | FOO             |
            | QUX   | ~pr:master      |
            | QUX2  | QUX             |
        When a pull request is opened
        And it is on the "master" branch
        Then the "FOO" job is started
        And the "QUX" job is started
        And that "QUX" build uses the same SHA as the "FOO" build
        Then the "FOO" job is succeeded
        And the "QUX" job is succeeded
        Then the "FOO2" job is not started
        And the "QUX2" job is started
        And that "QUX2" build uses the same SHA as the "FOO" build

    Scenario: Branch filtering (a pull request is opened to the staging branch)
        Given an existing pipeline with the workflow:
            | job   | requires        |
            | FOO   | ~pr             |
            | BAR   | ~pr:staging     |
            | BAZ   | ~pr:/^.*$/      |
            | QUX   | ~pr:master      |
        When a pull request is opened
        And it is on the "staging" branch
        Then the "FOO" job is not started
        And the "BAR" job is started
        And the "BAZ" job is started
        And the "QUX" job is not started
        And that "BAZ" build uses the same SHA as the "BAR" build
