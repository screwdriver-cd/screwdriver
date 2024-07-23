@user-teardown-step
@part2

Feature: User Teardown Steps

    Users want to be able to define teardown steps which will be run regardless of whether
    the build succeeds or fails.

    Rules:
        - Teardown steps needs to be at the end of the job
        - Teardown step names should be prefixed with "teardown-"

    Scenario: A Teardown step will be run when the build succeeds
        Given an existing pipeline for user-teardown-step with the workflow:
            | job     | requires |
            | success | ~commit  |
        When execute success job
        Then the job succeeded
        And the "main" step succeeded
        And the "teardown-when-succeed" step succeeded

    Scenario: A Teardown step will be run when the build fails
        Given an existing pipeline for user-teardown-step with the workflow:
            | job     | requires |
            | failure | ~commit  |
        When execute failure job
        Then the job failed
        And the "main" step failed
        And the "not-executed" step skipped
        And the "teardown-when-fail" step succeeded
