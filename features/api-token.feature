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
        Given the user "calvin" exists

    @ignore
    Scenario: Generate New API Token
        When a new API token is generated
        And the token is used to log in
        Then a valid JWT is received that represents "calvin"

    @ignore
    Scenario: List API Tokens
        And owns an existing API token
        When "calvin" lists all their tokens
        Then their API token is in the list
        And their token is safely described

    @ignore
    Scenario: Edit API Token Labels
        And owns an existing API token
        When "calvin" changes the label associated with the token
        Then their token will have that new label

    @ignore
    Scenario: Revoke API Token
        And owns an existing API token
        When "calvin" revokes the token
        And the token is used to log in
        Then the login attempt fails
