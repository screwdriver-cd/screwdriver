@environments
Feature: Envitonments

    Screwdriver exports a set of environment variables that you can rely on during build runtime

    Rules:
        - Environment variables should be available in a job

    Background:
        Given an existing pipeline with setting environment variables

    Scenario: Check Environment can be used
        When the "main" job with setting environment variables is started
        Then the "main" job with setting environment variables is success
