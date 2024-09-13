@sd-setup-scm
@parallel
@x1
Feature: sd-setup-scm

    Confirm that the environment variables related to Git in sd-setup-scm function works with Screwdriver.cd
    This test is localized by Yahoo Japan.

    Scenario: Normal build
        Given an existing pipeline for sd-setup-scm
        Given having two commit before an hour
        When start "~commit" job
        # external-config
        And the "external-config" job is triggered
        Then the "external-config" build succeeded
        # source-dir
        And the "source-dir" job is triggered
        Then the "source-dir" build succeeded
        # branch
        And the "branch" job is triggered
        Then the "branch" build succeeded
        # shallow-clone
        And the "shallow-clone" job is triggered
        Then the "shallow-clone" build succeeded
        # shallow-clone-single-branch
        And the "shallow-clone-single-branch" job is triggered
        Then the "shallow-clone-single-branch" build succeeded
        # shallow-clone-single-branch-with-depth
        And the "shallow-clone-single-branch-with-depth" job is triggered
        Then the "shallow-clone-single-branch-with-depth" build succeeded
        # shallow-clone-since-absolute
        And the "shallow-clone-since-absolute" job is triggered
        Then the "shallow-clone-since-absolute" build succeeded
        # shallow-clone-since-relative
        And the "shallow-clone-since-relative" job is triggered
        Then the "shallow-clone-since-relative" build succeeded
        # not-shallow-clone
        And the "not-shallow-clone" job is triggered
        Then the "not-shallow-clone" build succeeded
        # not-shallow-clone-single-branch
        And the "not-shallow-clone-single-branch" job is triggered
        Then the "not-shallow-clone-single-branch" build succeeded

    Scenario: External config build
        Given an existing pipeline for sd-setup-scm:child
        Given having two commit to child before an hour
        When start "~commit" job
        # external-config
        And the "external-config" job is triggered
        Then the "external-config" build succeeded
        # source-dir
        And the "source-dir" job is triggered
        Then the "source-dir" build succeeded
        # branch
        And the "branch" job is triggered
        Then the "branch" build succeeded
        # shallow-clone
        And the "shallow-clone" job is triggered
        Then the "shallow-clone" build succeeded
        # shallow-clone-single-branch
        And the "shallow-clone-single-branch" job is triggered
        Then the "shallow-clone-single-branch" build succeeded
        # shallow-clone-single-branch-with-depth
        And the "shallow-clone-single-branch-with-depth" job is triggered
        Then the "shallow-clone-single-branch-with-depth" build succeeded
        # shallow-clone-since-absolute
        And the "shallow-clone-since-absolute" job is triggered
        Then the "shallow-clone-since-absolute" build succeeded
        # shallow-clone-since-relative
        And the "shallow-clone-since-relative" job is triggered
        Then the "shallow-clone-since-relative" build succeeded
        # not-shallow-clone
        And the "not-shallow-clone" job is triggered
        Then the "not-shallow-clone" build succeeded
        # not-shallow-clone-single-branch
        And the "not-shallow-clone-single-branch" job is triggered
        Then the "not-shallow-clone-single-branch" build succeeded

    Scenario: PR build
        Given an existing pipeline for sd-setup-scm
        When a pull request is opened to "master" branch and commit twice
        # source-dir
        And the "source-dir" PR job is triggered
        Then the "source-dir" PR build succeeded
        # branch-pr
        And the "branch-pr" PR job is triggered
        Then the "branch-pr" PR build succeeded
        # not-shallow-clone
        And the "not-shallow-clone" PR job is triggered
        Then the "not-shallow-clone" PR build succeeded
        # not-shallow-clone
        And the "not-shallow-clone-single-branch" PR job is triggered
        Then the "not-shallow-clone-single-branch" PR build succeeded