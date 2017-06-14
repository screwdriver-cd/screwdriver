@apitoken
Feature: User API Token

    A user API token can be created and used in place of a password when
    interacting with the API. This would allow users to obtain valid JWTs and
    interact with the Screwdriver API in a programmatic way.

    Rules:
        - Tokens should be specifically tied to the user that issued them
        - Tokens should have a label/name associated with them
        - Users can add a description to their issued tokens, so they know what they're using them for
        - User can see when a token was last used
        - Users can revoke a token at any time
        - No one can ever look up the raw value after initially generating the token

    Background:
        Given "calvin" is logged in

    Scenario: Generate New API Token
        Given "calvin" does not own a token named "tiger"
        When a new API token named "tiger" is generated
        And the token is used to log in
        Then a valid JWT is received that represents "calvin"
        And the "tiger" token's 'last used' property is updated

    Scenario: List API Tokens
        Given "calvin" owns an existing API token named "tiger"
        When he lists all his tokens
        Then his "tiger" token is in the list
        And his token is safely described

    Scenario: Edit API Token Labels
        Given "calvin" owns an existing API token named "tiger"
        When he changes the label associated with the token
        Then his token will have that new label
        And the token's 'last used' property will not be updated

    Scenario: Revoke API Token
        Given "calvin" owns an existing API token named "tiger"
        When he revokes the token
        And the token is used to log in
        Then the login attempt fails

    Scenario: Refresh API Token
        Given "calvin" owns an existing API token named "tiger"
        When he refreshes the token
        And the old token value is used to log in
        Then the login attempt fails
        When the new token value is used to log in
        Then a valid JWT is received that represents "calvin"
        And the "tiger" token's 'last used' property is updated
