@parallel
@build-cache

Feature: build-cache

    Cache files and directories from a specific build.
    This feature allows you to keep build artifacts and dependent libraries of a build as a cache.

    Scenario: Success cache is correctly created and cache exists
        Given an existing pipeline for build-cache
        When start "create-cache" job
        And the "create-cache" build succeeded
        And the "check-event-and-pipeline" job is triggered
        Then the "check-event-and-pipeline" build succeeded
        When start "check-job" job
        And the "check-job" build succeeded
        Then start "check-job" job again and cache exists for job-level

