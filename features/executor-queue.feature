@executorqueue
Feature: Executor Queue

    Users want their build to enqueue for later execution if all the execution engines are
    offline or full, so that they do not have to worry about forgotten builds.

    Screwdriver should be pushing planned builds into a queue. And all available executors
    should be listening on that queue and taking items off when they have capacity.

    Rules:
        - Executors can determine if they are capable of running a new build.
        - Multiple instances of the same executor can connect to the queue.
        - Multiple executor types can connect to the same queue.
        - JWT is not created until build is sent to the executor.
        - Users know how far in the queue a build is.
    
    @ignore
    Scenario: Push a build into the queue
        When a new build is created
        Then that build is pushed into the queue
    
    @ignore
    Scenario: Run a queued build
        When the queue has one or more queued builds
        And an executor is capable of runnign a new build
        Then a build is taken from the queue
        And that build is running
    
    @ignore
    Scenario: Check how far a build in the queue a build is
        When a new build is created
        And that build is pushed into the queue
        Then users know how far in the queue that build is
