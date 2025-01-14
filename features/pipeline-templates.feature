@parallel
@pipelinetemplate
@x1

Feature: Pipeline Templates

    Pipeline template is simply an existing configuration for a pipeline that can be reused.
    A basic example would be something like this:
        name: node/test
        version: 1.0.0
        description: Template for testing
        maintainer: foo@bar.com
        config:
            shared:
                image: node:18
            jobs:
                main:
                    steps:
                        - init: npm install
                        - test: npm test

    To use a template, users would consume it like this in their screwdriver.yaml:
        template: node/test@1

    The user's config would be translated to:
        jobs:
            main:
                image: node:18
                steps:
                    - init: npm install
                    - test: npm test

    Rules:
        - Template owner can publish a template if
            - The format of template is valid
            - The build that is used to publish has the right permissions
            - No existing version already exists
        - Publishing a template should be stored to be retrieved later.
        - User can use a template by specifying it in their pipeline. If they specify
            - test/template:            pulls the latest version of test/template
            - test/template@1:          pulls the latest version of major 1 for test/template
            - test/template@1-stable:   pulls the latest version of major 1 with label "stable" for test/template
            - test/template@1.2:        pulls the latest patch of 1.2 of test/template

    Scenario Outline: A pipeline template owner wants to validate their template
        Given a <template> pipeline-level template
        When they submit pipeline template to the validator
        Then they are notified pipeline template has <number> errors

        Examples:
            | template | number |
            | valid    | no     |
            | invalid  | some   |

    Scenario Outline: Publish a pipeline template
        Given a "<template>" pipeline template
        When a pipeline with the "right" permission "<status>" to publish the pipeline template in "<job>"
        Then the pipeline template "<stored>" stored

        Examples:
            | template                        | status   | job             | stored |
            | publish-pipeline-template-test  | succeeds | publish-test    | is     |
            | test-pipeline-template          | fails    | publish-invalid | is not |

    Scenario Outline: Publish a pipeline template by another pipeline
        Given a "test-pipeline-template" pipeline template
        And the pipeline template exists
        When a pipeline with the "wrong" permission "fails" to publish the pipeline template in "<job>"
        Then the pipeline template "is not" stored

        Examples:
            | job             |
            | publish-valid   |
            | publish-invalid |

    Scenario Outline: Validate a pipeline template
        Given a "test-pipeline-template" pipeline template
        When a pipeline "<status>" to validate the pipeline template in "<job>"

        Examples:
            | status   | job              |
            | succeeds | validate-valid   |
            | fails    | validate-invalid |

    Scenario Outline: Hold trust status after publish a pipeline template
        Given a "<template>" pipeline template
        And the pipeline template exists
        And the pipeline template is "<trust>"
        When a pipeline with the "right" permission "succeeds" to publish the pipeline template in "<job>"
        Then the pipeline template "is" stored
        And the pipeline template is "<trust>"

        Examples:
            | template                          | trust      | job                |
            | test-trusted-pipeline-template    | trusted    | publish-trusted    |
            | test-distrusted-pipeline-template | distrusted | publish-distrusted |

    Scenario: Use pipeline template
        Given a "third" pipeline using a "test-pipeline-template" @ "1.0.0" pipeline template
        When user starts the job that uses pipeline template
        And the pipeline executes what is specified in the pipeline template

    Scenario: Pipeline shared config takes precedence over template config
        Given a "fourth" pipeline using a "test-pipeline-template" @ "1.0.0" pipeline template
        And user defined shared settings
        And the pipeline template has overwritten shared settings
        When user starts the job that uses pipeline template
        Then job settings are the template command

    Scenario: Pipeline exists job config takes precedence over template config
        Given a "fifth" pipeline using a "test-pipeline-template" @ "1.0.0" pipeline template
        And user defined exists jobs settings
        And the pipeline template has overwritten jobs settings
        When user starts the job that uses pipeline template
        Then job settings are the user command

    Scenario: Pipeline user defined job config takes precedence over template config
        Given a "sixth" pipeline using a "test-pipeline-template" @ "1.0.0" pipeline template
        And user defined additional jobs settings
        And the pipeline template has additional jobs settings
        When user starts the additional job that uses pipeline template
        Then additional job settings are the user command
