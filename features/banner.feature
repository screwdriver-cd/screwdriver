@banner
@parallel
Feature: Banner

    Banners are used by Screwdriver admins to notify users about important updates or changes. 
    This feature ensures that all users are aware of critical information, such as system maintenance, new feature releases, or any other relevant announcements. 
    By using banners, admins can effectively communicate with users and ensure that they are informed in a timely manner.

    Rules:
    - Only users with Screwdriver admin permissions can create banners.
    - Banners can be scoped as Global, Pipeline, or Build.
    - Once a banner is created, its scope cannot be changed.
    - When a banner is created with Pipeline or Build scope, a scopeId is required.
    - The banner message can be updated.
    - Banners can be deleted.

    Background:
        Given "calvin" is logged in
        # And "calvin" has Screwdriver admin permission

    Scenario: Banner with default scope
        When they create new banner with message "Hello World"
        Then they can see that the banner is created with default "GLOBAL" scope
        And banner is "updated" when they update the banner with "message" "Some Random Message"
        And banner is "not updated" when they update the banner with "scopeId" "1234"
        Then banner is deleted

    # Scenario: Create new banner with PIPELINE scope
        # must ensure pipeline exists

    # Scenario: List the API based on the pipeline scope

    # Scenario: Update the banner
        # make sure that the banner is updated using the acceptable fields and not acceptable

    # Scenario: Delete the banner
    