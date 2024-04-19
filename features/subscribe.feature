@subscribe
Feature: subscribe
  
  User can subscribe to external repositories so builds are triggered in the pipeline 
  whenever there are changes in those external repositories. 
  User can configure the pipeline to subscribe to webhook notifications for events such as ~pr, ~commit, ~tag and ~release. 
  Each job needs to be independently configured to respond to the subscribed event(s).

  Subscribe config can be declared in the config.
  shared:
    image: node:lts

  subscribe:
    scmUrls:
      - git@github.com:supra08/functional-workflow.git: ['~commit', '~pr']

  jobs:
      A:
          steps:
              - echo: echo test
          requires: [~pr, ~commit, ~subscribe]

  Rules:
    - Users should be able to define subscribe and scmUrls in the screwdriver config.
    - The supported subscribe is only ~pr, ~commit, ~tag, and ~release.

  Scenario: A pipeline subscribes to external repository for commit event
    Given an existing pipeline "test-pr-config-second" on branch "main" to be subscribed
    And an existing pipeline "test-pr-config" on branch "main" that subscribes
    When a new commit is pushed to "main" branch of pipeline "test-pr-config-second"
    Then the "second" job is triggered on branch "main" of repo "test-pr-config-second"
    And the "random" job is triggered on branch "main" of repo "test-pr-config"
    
  Scenario: A pipeline subscribes to external repository for commit event
    Given an existing pipeline "test-pr-config-second" on branch "main" to be subscribed
    And an existing pipeline "test-pr-config" on branch "main" that subscribes
    When a new commit is pushed to "random" branch of pipeline "test-pr-config-second"
    Then the "second" job is not triggered on branch "main" of repo "test-pr-config-second"
    And the "random" job is not triggered on branch "main" of repo "test-pr-config"