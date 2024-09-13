@templates
@parallel
Feature: Templates

    Templates are simply an existing configuration for a job that can be reused.
    A basic example would be something like this:
        name: node/test
        version: 1.0.0
        description: Template for testing
        maintainer: foo@bar.com
        config:
            image: node:6
            steps:
                - install: npm install
                - test: npm test

    To use a template, users would consume it like this in their screwdriver.yaml:
        jobs:
            main:
                template: node/test@1

    The user's config would be translated to:
        jobs:
            main:
                image: node:6
                steps:
                    - install: npm install
                    - test: npm test

    Rules:
        - Template owner can publish a template if
            - The format of template is valid
            - The build that is used to publish has the right permissions
            - No existing version already exists
        - Publishing a template should be stored to be retrieved later.
        - User can use a template by specifying it in their job. If they specify
            - test/template:            pulls the latest version of test/template
            - test/template@1:          pulls the latest version of major 1 for test/template
            - test/template@1-stable:   pulls the latest version of major 1 with label "stable" for test/template
            - test/template@1.2:        pulls the latest patch of 1.2 of test/template

    Scenario Outline: A template owner wants to validate their template
        Given a <template> job-level template
        When they submit it to the validator
        Then they are notified it has <number> errors

        Examples:
            | template | number |
            | valid    | no     |
            | invalid  | some   |

    Scenario Outline: Publish a template
        Given a "<template>" template
        When a pipeline with the "right" permission "<status>" to publish the template in "<job>"
        Then the template "<stored>" stored

        Examples:
            | template      | status   | job             | stored |
            | publish-test  | succeeds | publish-test    | is     |
            | test-template | fails    | publish-invalid | is not |

    Scenario Outline: Publish a template by another pipeline
        Given a "test-template" template
        And the template exists
        When a pipeline with the "wrong" permission "fails" to publish the template in "<job>"
        Then the template "is not" stored

        Examples:
            | job             |
            | publish-valid   |
            | publish-invalid |

    Scenario Outline: Validate a template
        Given a "test-template" template
        When a pipeline "<status>" to validate the template in "<job>"

        Examples:
            | status   | job              |
            | succeeds | validate-valid   |
            | fails    | validate-invalid |

    Scenario Outline: Hold trust status after publish a template
        Given a "<template>" template
        And the template exists
        And the template is "<trust>"
        When a pipeline with the "right" permission "succeeds" to publish the template in "<job>"
        Then the template "is" stored
        And the template is "<trust>"

        Examples:
            | template                 | trust      | job                |
            | test-trusted-template    | trusted    | publish-trusted    |
            | test-distrusted-template | distrusted | publish-distrusted |

    Scenario: Merges template into user's config
        Given a pipeline using a "test-template" @ "1.0.0" template in job "use-template"
        When user starts the pipeline
        Then the job executes what is specified in the template

    Scenario: Job config takes precedence over template config
        Given a pipeline using a "test-template" @ "1.0.0" template in job "custom-template"
        And user has some settings defined
        And the template has the same settings with different values
        When user starts the pipeline
        Then settings is the job settings
