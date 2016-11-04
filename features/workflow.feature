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
            | job | triggers |
            | FOO | BAR      |
        When the "FOO" job is started
        And the build failed
        Then the "BAR" job is not started

    Scenario: Serially
        Given an existing pipeline with the workflow:
            | job | triggers |
            | FOO | BAR      |
        When the "FOO" job is started
        And the build succeeded
        Then the "BAR" job is started
        And that "BAR" build uses the same SHA as the "FOO" build

    Scenario: Parallel
        Given an existing pipeline with the workflow:
            | job | triggers |
            | FOO | BAR+BAZ  |
        When the "FOO" job is started
        And the build succeeded
        Then the "BAR" job is started
        And the "BAZ" job is started
        And that "BAR" build uses the same SHA as the "FOO" build
        And that "BAZ" build uses the same SHA as the "FOO" build

    Scenario: Join
        Given an existing pipeline with the workflow:
            | job     | triggers |
            | FOO     | BAR+BAZ  |
            | BAR+BAZ | XYZZY    |
        When the "FOO" job is started
        And the "FOO" build succeeded
        And the "BAR" job is started
        And the "BAZ" job is started
        Then the "XYZZY" job is not started
        And the "BAR" build succeeded
        And the "BAZ" build succeeded
        Then the "XYZZY" job is started
        And that "XYZZY" build uses the same SHA as the "FOO" build
