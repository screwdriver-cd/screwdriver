@sd-cmd
Feature: Commands

    Users want to share binaries or scripts across multiple containers
    so that they can easily use some commands in all containers.

    Screwdriver should have a single interface for executing a versioned command
    (via remote binary, docker image, or habitat package) during a build.

    Background:
        Given an existing pipeline

    Scenario Outline: Publish and execute commands
        Given <command> command does not exist yet
        When execute <job> job
        Then the job is completed successfully
        And the command is published with <format> format
        And "exec" step executes the command with arguments: <arguments>
        And the command is deleted

        Examples:
            | command      | job     | format  | arguments |
            | binary-func-test  | binary  | binary  | "foo bar" |
            | habitat-func-test | habitat | habitat | "-v"      |

    Scenario: Promote a command
        Given promote-func-test command does not exist yet
        And "1.0.0" version of the command is uploaded with "stable" tag
        And "1.0.1" version of the command is uploaded with "latest" tag
        When execute promote job
        Then the job is completed successfully
        And "1.0.1" is tagged with "stable"
        And "1.0.1" is tagged with "GA"
        And "stable" tag is removed from "1.0.0"
        And the command is deleted

    @ignore
    Scenario: Get list of explicit command versions
        When execute "list"
        Then get list of explicit versions matching that range with comma separated tags next to applicable tags
