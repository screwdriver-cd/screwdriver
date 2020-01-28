@pipelinetoken
Feature: Pipeline Token

    A Pipeline token can be created and used in place of a password when
      interacting with the regarding pipeline API. This would allow users to obtain valid JWTs and
      interact with the Screwdriver API in a programmatic way.

  Rules:
      - Tokens should be specifically tied to the user that issued them
      - Tokens should have a label/name associated with them
      - Users can add description to their issued, so they know what they're using them for
      - User can see when a token was last used
      - Users can revoke a token at any time
      - No one can ever look up the raw value after initially generating the token

  Background:
    Given: "calvin" is logged in
  @ignore
  Scenario: Generate New Pipeline Token
    Given "calvin" created pipeline dose not own a token named "tiger"
    When a new Pipeline token named "tiger" is generated
    And the token is used to log in to the specific pipeline
    Then a valid JWT is received that represents "calvin"
    And the "tiger" token's 'last used' property is updated

  @ignore
  Scenario: List Pipeline Tokens
    Given "calvin" created pipeline owns an existing Pipeline token named "tiger"
    When he lists all his tokens
    Then his "tiger" token is in the list
    And his token is safely described

  @ignore
  Scenario: Edit Pipeline Tokens
    Given "calvin" created pipeline owns an existing Pipeline token named "tiger"
    When he changes the label associated with the token
    Then his token will have that new label
    And the token's 'last used' property will not be update

  @ignore
  Scenario: Revoke Pipeline Token
    Given "calvin" created pipeline owns an existing Pipeline token named "tiger"
    When he revokes the token
    And the token is used to log in to the specific pipeline
    Then the login attempt fails

  @ignore
  Scenario: Refresh Pipeline Token
    Given "calvin" created pipeline owns an existing Pipeline token named "tiger"
    When he refreshes the token
    And the old token value is used to log in to the specific pipeline
    Then the login attempt fails
    When the new token value is used to log in to the specific pipeline
    Then a valid JWT is received that represents "calvin"
    And the "tiger" token's 'last used' property is updated

  @ignore
  Scenario: Call API using a valid pipeline token
    Given "calvin" created pipeline owns an existing Pipeline token named "tiger"
    When he calls API using a valid Pipeline token
    And the token is used to log in to the specific pipeline
    Then he receives valid value from API

  @ignore
  Scenario: Call API using a invalid pipeline token
    Given "calvin" created pipeline owns an invalid Pipeline token named "tiger"
    When he calls API Using a invalid Pipeline token
    Then he can not receives the value from API

  @ignore
  Scenario: Call API using a not tied him pipeline token
    Given "calvin" created pipeline owns Pipeline token name "tiger" that is not tied to pipeline
    When he calls API using token name "tiger"
    Then he can not receives the value from API

