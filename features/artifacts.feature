@artifacts
@part2

Feature: Artifacts

    Screwdriver allows you to view and download the artifacts generated during the build process at a later time.
    Enabling zip compression when saving your artifacts may speed up the build.

    Rules:
    -　The user must be able to select and review all or some of the artifacts generated during the build

    Background:
        Given an existing pipeline with the workflow:
            | job | triggers |
            | main | ~commit |
            | zipped | ~commit |
        And "calvin" has admin permission to the pipeline

    Scenario: Verify that artifacts have been saved
        And "calvin" is logged in
        When the "main" job is started
        Then an event is created
        And the "main" build succeeds
        And artifacts were found in the build

    @ignore
    Scenario: Verify that the artifacts have been saved with zipping enabled.
        And "calvin" is logged in
        When the "zipped" job is started
        Then an event is created
        And the "zipped" build succeeds
        And artifacts were found in the build
