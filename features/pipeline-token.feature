@pipelinetoken
@part2
@ignore

Feature: Pipeline Token

    A Pipeline token can be created and used in place of a password when
    interacting with the regarding pipeline API. This would allow users to obtain valid JWTs and
    interact with the Screwdriver API in a programmatic way.

    Rules:
        - Tokens should be specifically tied to the pipeline that issued them
        - Tokens should have a label/name associated with them
        - Users can add description to their issued, so they know what they're using them for
        - User can see when a token was last used
        - Users can revoke a token at any time
        - No one can ever look up the raw value after initially generating the token

  Background:
    Given: "calvin" is logged in

  Scenario: Generate New Pipeline Token
    Given "calvin" created pipeline dose not own a token named "tiger"
    When a new Pipeline token named "tiger" is generated
    And the token is used to log in to the specific pipeline
    Then a valid JWT is received that represents the pipeline
    And the "tiger" token's 'last used' property is updated

  Scenario: List Pipeline Tokens
    Given "calvin" created pipeline owns an existing Pipeline token named "tiger"
    When the pipeline list all tokens
    Then "tiger" token is in the list
    And the token is safely described

  Scenario: Edit Pipeline Tokens
    Given "calvin" created pipeline owns an existing Pipeline token named "tiger"
    When he changes the label associated with the token
    Then the token will have that new label
    And the token's 'last used' property will not be update

  Scenario: Revoke Pipeline Token
    Given "calvin" created pipeline owns an existing Pipeline token named "tiger"
    When he revokes the token
    And the token is used to log in to the specific pipeline
    Then the login attempt fails

  Scenario: Refresh Pipeline Token
    Given "calvin" created pipeline owns an existing Pipeline token named "tiger"
    When he refreshes the token
    And the old token value is used to log in to the specific pipeline
    Then the login attempt fails
    When the new token value is used to log in to the specific pipeline
    Then a valid JWT is received that represents the pipeline
    And the "tiger" token's 'last used' property is updated

  Scenario: Call API using a valid pipeline token
    Given "calvin" created pipeline owns an existing Pipeline token named "tiger"
    When he calls API using a valid Pipeline token
    And the token is used to log in to the specific pipeline
    Then he receives valid value from API

  Scenario: Call API using a invalid pipeline token
    Given "calvin" created pipeline owns an invalid Pipeline token named "tiger"
    When he calls API Using a invalid Pipeline token
    Then he can not receives the value from API

