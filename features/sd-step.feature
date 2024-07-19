@sd-step
@parallel

Feature: Shared Steps

    Users want to be able to share code for building software, so that their builds are
    less prone to drift.

    Users share code by cloning git repositories or installing packages in their build.
    However, due to the ability to select your own containers to run it, both of these
    options are limited to either only share shell scripts or specific to one language.
    We need an option to effectively share language-independent commands.

    Screwdriver should support an "omnibus-like" package manager natively and offer a
    cached installation/download of a global Screwdriver SDK state.

    Rules:
    - Package manager is available in every build.
    - Global SDK state is restored into the package manager installation/download location.
    - Method to update global SDK state.
    - Method to refer to installed packages via semver.

    Scenario Outline: Use package via sd-step
        Given an existing pipeline with <image> image and <package> package
        When the main job is started
        And sd-step command is executed to use <package> package
        Then <package> package is available via sd-step

        Examples:
            | image         | package   |
            | golang:latest | core/node |

    @ignore
    Scenario Outline: Use package via sd-step with specified version
        Given an existing pipeline with <image> image and <package> package
        When the <job> job is started
        And sd-step command is executed to use <package> package with specified version <version>
        Then <package> package is available via sd-step with specified version <version>

        Examples:
            | job     | image         | package   | version |
            | tilde   | golang:latest | core/node |  ~6.9.0 |
            | hat     | golang:latest | core/node |  ^6.0.0 |
            | specify | golang:latest | core/node |   4.2.6 |
