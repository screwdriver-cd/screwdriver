Feature: hapi server

Scenario: hapi server is running
    Given a running hapi server
    When I access a status endpoint
    Then I should get an OK response
