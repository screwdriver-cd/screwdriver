@executorqueue
@part2

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
    Scenario Outline: Push a build into the queue
        Given an executor type is <type>
        When a new build is created
        Then that build is pushed into the queue
        
        Examples:
            | type    |
            | k8s     |
            | docker  |
            | jenkins |

    @ignore
    Scenario Outline: Run a queued build
        Given an executor type is <type>
        When the queue has one or more queued builds
        And an executor is capable of running a new build
        Then a build is taken from the queue
        And that build is running

        Examples:
            | type    |
            | k8s     |
            | docker  |
            | jenkins |
    
    @ignore
    Scenario Outline: No executors can handle a new build
        Given an executor type is <type>
        When the queue has one or more queued builds
        And all executors are offline or full
        Then no new builds are running
        And the queue remains as it is

        Examples:
            | type    |
            | k8s     |
            | docker  |
            | jenkins |

    @ignore
    Scenario Outline: Check how far a build in the queue a build is
        Given an executor type is <type>
        When a new build is created
        And that build is pushed into the queue
        Then users know how far in the queue that build is

        Examples:
            | type    |
            | k8s     |
            | docker  |
            | jenkins |
