@parallel
Feature: API Server

Scenario: Server is running
    Given a running API server
    When I access the status endpoint
    Then I should get an OK response

Scenario: Versions are available
    Given a running API server
    When I access the versions endpoint
    Then I should get a list of versions
