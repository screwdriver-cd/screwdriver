@templates
Feature: Templates

    Description from screwdriver-cd/screwdriver#470

    Scenario Outline: A template owner wants to validate their template
        Given a <template> job-level template
        When they submit it to the API
        Then they are notified it has <number> errors

        Examples:
          | template | number |
          |  valid   |   no   |
          |  invalid |  some  |
