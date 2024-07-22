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

    Scenario Outline: Validate a command
        Then a pipeline "<status>" to validate the command in "<job>"

        Examples:
            | status   | job              |
            | succeeds | validate-valid   |
            | fails    | validate-invalid |

    Scenario Outline: Hold trust status after publish a command
        Given a "<command>" command
        And the command exists
        And the command is "<trust>"
        When a pipeline with the "right" permission "succeeds" to publish the command in "<job>"
        Then the command "is" stored
        And the command is "<trust>"

        Examples:
            | command                  | trust      | job                |
            | test-trusted-command     | trusted    | publish-trusted    |
            | test-distrusted-command  | distrusted | publish-distrusted |

    Scenario Outline: Publish a command by another pipeline
        Given a "test-trusted-command" command
        And the command exists
        Then a pipeline with the "wrong" permission "fails" to publish the command in "<job>"

        Examples:
            | job             |
            | publish-trusted |
