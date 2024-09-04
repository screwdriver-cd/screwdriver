@environments
@x1

Feature: Environments

    Screwdriver exports a set of environment variables that you can rely on during build runtime

    Rules:
        - Environment variables should be available in a job

    Background:
        Given an existing pipeline with setting environment variables

    Scenario: Check Environment can be used
        When the "main" job that uses "FOO" environment variable is started
        Then the job was able to use the "FOO" environment variable
