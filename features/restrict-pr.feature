@restrict-pr
Feature: Restrict-pr

    The user wants to control the execution of the PR job depending on the source and destination of the Pull Request.

    Rules:
        -　The restrict-pr setting allows the following controls
        -- none: Start all PR build
        -- fork: Do not start PR build from fork
        -- branch: Do not start PR build from same repository
        -- all: Do not start all PR build

    Scenario: Create a pull request for restrict pr value is none from the same repository
        Given an existing pipeline with the source directory "none" and with the workflow jobs:
            | job           | requires          |
            | main          | ~pr               |
        When a branch is created for test_branch on "screwdriver-cd-test" organization
        And a new file is added to the "none" directory
        And a pull request is opened from the "screwdriver-cd-test" organization
        Then the PR job of "none" is triggered because it is not restricted

    Scenario: Create a pull request for restrict pr value is fork from the same repository
        Given an existing pipeline with the source directory "fork" and with the workflow jobs:
            | job           | requires          |
            | main          | ~pr               |
        When a branch is created for test_branch on "screwdriver-cd-test" organization
        And a new file is added to the "fork" directory
        And a pull request is opened from the "screwdriver-cd-test" organization
        Then the PR job of "fork" is triggered because it is not restricted

    Scenario: Create a pull request for restrict pr value is branch from the same repository
        Given an existing pipeline with the source directory "branch" and with the workflow jobs:
            | job           | requires          |
            | main          | ~pr               |
        When a branch is created for test_branch on "screwdriver-cd-test" organization
        And a new file is added to the "branch" directory
        And a pull request is opened from the "screwdriver-cd-test" organization
        Then the PR job of "branch" is not triggered because it is restricted

    Scenario: Create a pull request for restrict pr value is all from the same repository
        Given an existing pipeline with the source directory "all" and with the workflow jobs:
            | job           | requires          |
            | main          | ~pr               |
        When a branch is created for test_branch on "screwdriver-cd-test" organization
        And a new file is added to the "all" directory
        And a pull request is opened from the "screwdriver-cd-test" organization
        Then the PR job of "all" is not triggered because it is restricted



    Scenario: Create a pull request for restrict pr value is none from the forked repository
        Given an existing pipeline with the source directory "none" and with the workflow jobs:
            | job           | requires          |
            | main          | ~pr               |
        When a branch is created for test_branch on "screwdriver-cd" organization
        And a new file is added to the "none" directory
        And a pull request is opened from the "screwdriver-cd" organization
        Then the PR job of "none" is triggered because it is not restricted

    Scenario: Create a pull request for restrict pr value is fork from the forked repository
        Given an existing pipeline with the source directory "fork" and with the workflow jobs:
            | job           | requires          |
            | main          | ~pr               |
        When a branch is created for test_branch on "screwdriver-cd" organization
        And a new file is added to the "fork" directory
        And a pull request is opened from the "screwdriver-cd" organization
        Then the PR job of "fork" is not triggered because it is restricted

    Scenario: Create a pull request for restrict pr value is branch from the forked repository
        Given an existing pipeline with the source directory "branch" and with the workflow jobs:
            | job           | requires          |
            | main          | ~pr               |
        When a branch is created for test_branch on "screwdriver-cd" organization
        And a new file is added to the "branch" directory
        And a pull request is opened from the "screwdriver-cd" organization
        Then the PR job of "branch" is triggered because it is not restricted

    Scenario: Create a pull request for restrict pr value is all from the forked repository
        Given an existing pipeline with the source directory "all" and with the workflow jobs:
            | job           | requires          |
            | main          | ~pr               |
        When a branch is created for test_branch on "screwdriver-cd" organization
        And a new file is added to the "all" directory
        And a pull request is opened from the "screwdriver-cd" organization
        Then the PR job of "all" is not triggered because it is restricted