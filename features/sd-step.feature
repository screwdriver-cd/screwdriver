@sd-step
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
    - Package manager can use the global SDK state to reduce installation/download time.
    - Method to update global SDK state.
    - Method to refer to installed packages via semver.

    Background:
        Given an existing pipeline with these images and packages with version:
            | image          | package        | version        |
            | golang:latest  | node           | ^4.0.0         |
        And <image> image is used in the pipeline

    Scenario: Use package via sd-step
        When the main job is started
        And sd-step command is executed to use <package> package
        Then <package> package is available via sd-step

    @ignore
    Scenario: Use package via sd-step with specified version
        When the main job is started
        And sd-step command is executed to use <package> package with specified version <version>
        Then <package> package is available via sd-step with specified version <version>

    @ignore
    Scenario: Use shared package via sd-step
        And <package> package is shared
        When the main job is started
        And sd-step command is executed to use <package> package
        Then <package> package is available via sd-step without installation/download time
