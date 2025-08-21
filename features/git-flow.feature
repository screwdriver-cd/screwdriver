@gitflow
@parallel
@x1
Feature: Git Flow

    One of the key features of Screwdriver is the ability to integrate directly into the developer's
    daily process - in this case, the git flow. This includes both continuous delivery
    (commit -> production) and testing proposed code changes (a.k.a. pull requests).

    Rules:
        - Users should not have to configure GitHub Hooks manually
        - Pull Request builds should use the "main" job configuration
        - Pull Request builds should have a way to identify they are in a PR build
        - GitHub statuses should only be updated for Pull Requests

    Background:
        Given an existing pipeline
        And a pipeline with all stopped builds

    Scenario: New Pull Request
        When a pull request is opened
        And it is targeting the pipeline's branch
        Then a new build from "main" should be created to test that change
        And the build should know they are in a pull request (pr no, fork, and commit)
        And the GitHub status should be updated to reflect the build's status

    Scenario: Updated Pull Request
        And an existing pull request targeting the pipeline's branch
        When new changes are pushed to that pull request
        Then any existing builds should be stopped
        Then a new build from "main" should be created to test that change

    Scenario: Closed Pull Request
        When a new Skip CI commit is pushed against the pipeline's branch
        And an existing pull request targeting the pipeline's branch
        And the pull request is closed
        Then any existing builds should be stopped
        And a new build from "closed-trigger" should be created on the latest sha
        And the build succeeded
        And the build should have a metadata for a closed pr
        And a new build from "branch-specific-closed-trigger" should not be created on the latest sha

    Scenario: Closed Pull Request Targeting Specific Branch
        When a new Skip CI commit is pushed against the pipeline's branch
        And a pull request is opened to "pr-closed-trigger" branch
        And the pull request is merged
        Then a new build from "branch-specific-closed-trigger" should be created on the latest sha
        And the build succeeded
        And the build should have a metadata for a merged pr
        And a new build from "closed-trigger" should not be created on the latest sha

    Scenario: New Commit
        When a new commit is pushed against the pipeline's branch
        Then a new build from "main" should be created to test that change

    Scenario: New Skip CI Commit
        When a new Skip CI commit is pushed against the pipeline's branch
        Then a new build from "main" should not be created to test that change

    Scenario: New Tag
        When a tag "v1.0" is created
        Then a new build from "tag-triggered" should be created to test that change
        And the build succeeded
        And a new build from "tag-specific-triggered" should be created to test that change

    Scenario: New Specific Tag
        When a tag "v2.0" is created
        Then a new build from "tag-triggered" should be created to test that change
        And the build succeeded
        And a new build from "tag-specific-triggered" should not be created to test that change

    Scenario: New Annotated Tag
        When an annotated tag is created
        Then a new build from "tag-triggered" should be created to test that change

    Scenario: New Release
        When a release "v1.0" is created
        Then a new build from "release-triggered" should be created to test that change
        And the build succeeded

    Scenario: New Specific Release
        When a release "v2.0" is created
        Then a new build from "release-triggered" should be created to test that change
        And the build succeeded
        And a new build from "release-specific-triggered" should not be created to test that change

    Scenario: New Release with Annotated Tag
        When a release with annotated tag is created
        Then a new build from "release-triggered" should be created to test that change
