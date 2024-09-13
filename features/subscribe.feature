@subscribe
@x1
Feature: subscribe

  User can subscribe to external repositories so builds are triggered in the pipeline whenever there are changes in those external repositories.
  User can configure the pipeline to subscribe to webhook notifications for events such as ~pr, ~commit, ~tag and ~release.
  Each job needs to be independently configured to respond to the subscribed event(s).

  The configuration below illustrates how to subscribe to an upstream repository for both commit and pull request events.

  shared:
    image: node:lts
  subscribe:
    scmUrls:
      - git@github.com:supra08/functional-workflow.git: ['~commit', '~pr']
  jobs:
    random:
      template: sd/noop@latest
      requires: [~subscribe]

  Scenario: A repository is subscribed by two pipelines, one triggered by pull request events of the repo and the other by commit
    # Two pipelines for same "test-subscribe-parent" on different branch
    Given an existing pipeline "test-subscribe-parent" on branch "child" with the following config
      | job       | requires      |
      | second    | ~pr, ~commit  |
    And an existing pipeline "test-subscribe-parent" on branch "main" with the following config
      | job       | requires      |
      | second    | ~pr, ~commit  |
    And an existing pipeline "test-subscribe-first-child" on branch "main" with the following config
      | job       | requires                  |
      | random    | ~pr, ~commit, ~subscribe  |
    And an existing pipeline "test-subscribe-second-child" on branch "main" with the following config
      | job       | requires                  |
      | random    | ~pr, ~commit, ~subscribe  |
    And pipeline "test-subscribe-first-child" subscribes to "commit" trigger of "test-subscribe-parent" against the main branch
    And pipeline "test-subscribe-second-child" subscribes to "pr" trigger of "test-subscribe-parent" against the main branch
    When a new commit is pushed to "main" branch of repo "test-subscribe-parent"
    Then the "second" job is triggered on branch "main" of repo "test-subscribe-parent"
    And the "random" job is triggered on branch "main" of repo "test-subscribe-first-child"
    And the "random" job is not triggered on branch "main" of repo "test-subscribe-second-child"
    When a new commit is pushed to "random" branch of repo "test-subscribe-parent"
    Then the "second" job is not triggered on branch "main" of repo "test-subscribe-parent"
    And the "random" job is not triggered on branch "main" of repo "test-subscribe-first-child"
    And the "random" job is not triggered on branch "main" of repo "test-subscribe-second-child"
    When a pull request is opened from "testpr" branch of repo "test-subscribe-parent"
    Then the "second" job is triggered on branch "main" of repo "test-subscribe-parent"
    And the "random" job is not triggered on branch "main" of repo "test-subscribe-first-child"
    And the "random" job is triggered on branch "main" of repo "test-subscribe-second-child"