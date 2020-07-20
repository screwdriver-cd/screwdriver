@deploy-keys
Feature: Deploy keys

    Users would want to be able to automatically generate deploy key pair and add it to
    their SCM's repository configuration settings. This feature helps in adding specific
    private repositories in the pipeline with giving organization wide access.
    
    This feature needs to be activated at the API and level and chosen in the UI for 
    screwdriver to automatically generate the key pair.

    Rules:
    - The deploy key pair should only be generated if a flag "autoDeployKeyGeneration" is
    set to "true" in the API and user chooses the option in the UI.
    - If feature is deactivated in API, the user won't be able to see the option in the UI.
    - UI gets the activation option through the auth contexts.
    
    Scenario: Create a new pipeline
        Given the autoDeployKeyGeneration option is activated in the API
        When "calvin" selects the option in the UI and creates a pipeline
        Then the keys are automatically added to the repo and secrets