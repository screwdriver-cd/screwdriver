@templates
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
        When they submit it to the API
        Then they are notified it has <number> errors

        Examples:
          | template | number |
          |  valid   |   no   |
          |  invalid |  some  |

    @ignore
    Scenario Outline: Merges template into user's config
        Given an existing pipeline with job main
        And an existing template called Test
        And user specifies template Test in job main
        When user starts the pipeline
        Then job main executes what is specified in template

    @ignore
    Scenario Outline: Job config takes precedence over template config
        Given an existing pipeline with job main
        And an existing template called Test
        And user specifies template Test in job main
        And user has some settings defined
        And template Test has the same settings with different values
        When user starts the pipeline
        Then settings is the job settings

    @ignore
    Scenario Outline: Publish template stores the template
        Given a template with a(n) <format> format
        And the template does not exist
        When a pipeline with the <permission> permissions publishes the template
        Then the template <stored> stored

        Examples:
          | format  | permission  | stored
          | valid   | right       | is
          | valid   | wrong       | is not
          | invalid | right       | is not
          | invalid | wrong       | is not
