@auth
@part1

Feature: Authorization

    Another part of the developer's daily process is their constant interaction with GitHub. Their
    source code, documentation, and work tracking is all housed in this system. And that system
    has a certain consistency with it - one which we should attempt to be be seamless with.  In this
    case we're targeting authorization.

    Developers already have a way to define (in GitHub) who can view repositories, contribute to
    them, and even manage them. And since our primary input is a repository, we should map our
    authorization model on the same principles.

    Rules:
        - Users who can administer a GitHub repository can create/edit/delete that pipeline
        - Users who can change code of a GitHub repository can start/stop builds on that pipeline
        - Users who can only view the GitHub repository can only view that pipeline
        - Users who cannot see the GitHub repository cannot even see that the pipeline exists

    Background:
        Given an existing repository with these users and permissions:
            | name          | permission  |
            | calvin        | admin       |
            | hobbes        | contributor |
            | susie         | read-only   |
            | miss wormwood | no access   |
        And an existing pipeline with that repository

    @ignore
    Scenario: No Access
        And "miss wormwood" is logged in
        Then they can not see the pipeline
        And they can not start the "main" job
        And they can not delete the pipeline

    @ignore
    Scenario: Read Only
        And "susie" is logged in
        Then they can see the pipeline
        And they can not start the "main" job
        And they can not delete the pipeline

    @ignore
    Scenario: Committer
        And "hobbes" is logged in
        Then they can see the pipeline
        And they can start the "main" job
        And they can not delete the pipeline

    Scenario: Admin
        And "calvin" is logged in
        Then they can see the pipeline
        And they can start the "main" job
        And they can delete the pipeline

    @ignore
    Scenario: Admin2
        And "calvin" is logged in
        And they update the checkoutUrl
        Then the pipeline checkoutUrl is updated
        And the pipeline has the same id as before

    @ignore
    Scenario: SCM Context
        And "github:calvin" is logged in
        Then they can see the pipeline
        And they can start the "main" job
        And they can delete the pipeline
