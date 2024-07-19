@secrets

Feature: Secrets

    One of the big blockers with continuous delivery in the existing tools out there is the
    availability of secrets to the build. Secrets are needed for publishing packages or code,
    deploy to services, and remotely testing if a service is working.

    The systems out there usually support secrets in one of three camps:
     - A secret can be available to all people on the shared system
     - A secret can be available just to your pipeline
     - A secret can be available just to a job in your pipeline

    Screwdriver should provide a combination of options two and three. This gives developers the
    ability to specify secrets that all jobs need to use, and then restrict production secrets
    to just the production jobs.

    Additionally, developers should be able to customize what secrets are available in a pull
    request, even as fine-grained as should it be available in a forked pull-request.

    Rules:
        - Saved secrets cannot be viewed by developers, only the name of them should be available
        - Secrets can only be listed, added, changed, or removed by admins of the pipeline
        - Secrets can be strings or generated SSH keys
        - Secrets should be available as environment variables

    Background:
        Given an existing repository for secret with these users and permissions:
            | name          | permission  |
            | calvin        | admin       |
            | hobbes        | contributor |
        And an existing pipeline with that repository with the workflow:
            | job  | triggers |
            | main | second   |

    Scenario: Adding Global Secrets
        And "calvin" is logged in
        When a secret "foo" is added globally
        And the "main" job is started
        Then the "foo" secret should be available in the build
        And the "second" job is started
        Then the "foo" secret should be available in the build

    @ignore
    Scenario: Adding Job Secrets
        And "calvin" is logged in
        When a secret "foo" is added to the "main" job
        And the "main" job is started
        Then the "foo" secret should be available in the build
        And the build succeeded
        And the "second" job is started
        Then the "foo" secret should not be available in the build

    @ignore
    Scenario: Adding PR Secrets
        And "calvin" is logged in
        When a secret "foo" is added to the "PR-nofork" job
        And the "PR-fork" job is started
        Then the "foo" secret should not be available in the build
        And the "PR-nofork" job is started
        Then the "foo" secret should be available in the build

    Scenario: Secret Admin Permissions
        And "calvin" is logged in
        When a secret "foo" is added globally
        Then the user can view the secret exists
        And the user can not view the value

    @ignore
    Scenario: Secret Non-Admin Permissions
        And "calvin" is logged in
        When a secret "foo" is added globally
        And "hobbes" is logged in
        Then the user can not view the secret exists
        And the user can not view the value
