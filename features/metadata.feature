@parallel
@metadata

Feature: Metadata

    Users want to pass structured data between their builds.
    The most common way is to use the value of the current Git tag. But that data
    cannot be guaranteed to be correct.

    Given this simple pipeline:
    main -> deploy -> promote

    The deploy job would need to know the version of the application that was published
    in the main job, while the promote job would need to know the version that was
    tested in the deploy job. This information is not available with just that git tag.

    Instead, Screwdriver should provide a simple interface for reading/writing values
    that can be passed between builds in the same event.

    Rules:
    - meta is a command-line client (written in go) that is made available to the
    build container.
    - Metadata should be passed from one job to the next in succession (in the same
    event).
    - When combining the results of matrix builds, they should be merge/replaced in
    a random order (to ensure users don't depend on a side-effect).
    - When the event is done, a record of the metadata should be stored there as well.
    - Metadata can contain strings, numbers, boolean, objects, and arrays. The interface
    should account for this.
    - meta set should not output anything, except during failures (STDERR).
    - meta get should output in string representation with no newlines.

    Stretch (gold bar):
    - meta can read in from a file or STDIN.
    - meta get --previous can read from the previous successful event.

    Background:
        Given a metadata starts with an empty object

    Scenario Outline: Adding some data to metadata
        Given an existing pipeline with the workflow:
            | job  | triggers |
            | main | BAR      |
            | BAR  | BAZ      |
        When the "main" job is started
        Then add the { "foo": <foobar> } to metadata in the "main" build container
        And the build succeeded
        And the "BAR" job is started
        Then in the build, the { "foo": <foobar> } is available from metadata
        And add the { "bar": <barbaz> } to metadata in the "BAR" build container
        And the build succeeded
        And the "BAZ" job is started
        Then in the build, the { "foo": <foobar> } is available from metadata
        And in the build, the { "bar": <barbaz> } is available from metadata
        And the build succeeded
        And the event is done
        Then a record of the metadata is stored

        Examples:
            | foobar       | barbaz       |
            | "foobar"     | "barbaz"     |
#            | 10           | 20           |
#            | true         | false        |
#            | ["arrg"]     | ["ARRG"]     |
#            | { "x": "y" } | { "w": "z" } |

    @ignore
    Scenario: Combining the results of matrix builds
        Given an existing pipeline with the workflow:
            | job  | triggers |
            | main | BAR      |
        And "main" is a matrix job with BAZ:[1,2]
        When the "main" job is started
        Then add the { "foo": "foobar" } to metadata in the BAZ = 1, "main" build
        And add the { "foo": "barbaz" } to metadata in the BAZ = 2, "main" build
        And the build succeeded
        And the "BAR" job is started
        Then in the build, the value of "foo" is either "foobar" or "barbaz" from metadata
