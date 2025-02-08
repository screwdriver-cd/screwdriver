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

    Scenario: Banner with global scope
        When they create new banner with message "Hello World" and "GLOBAL" scope
        Then they "can" see that the banner is created with "GLOBAL" scope
        And banner is "updated" when they update the banner with "message" "Some Random Message"
        And banner is "not updated" when they update the banner with "scopeId" "1234"
        And banner is "not updated" when they update the banner with "scope" "PIPELINE"
        Then calvin has expired token
        And they "can" see that the banner is created with "GLOBAL" scope
        Then "calvin" is logged in
        Then banner is deleted

    Scenario: Banner with pipeline scope
        Given an existing pipeline
        And there is no banner associated to that pipeline
        When they create new banner with message "Hello World" and "PIPELINE" scope
        Then they "can" see that the banner is created with "PIPELINE" scope
        And they can get the banner associated to that pipeline
        And banner is "updated" when they update the banner with "isActive" "false"
        And banner is "not updated" when they update the banner with "scope" "GLOBAL"
        Then calvin has expired token
        Then they "cannot" see that the banner is created with "PIPELINE" scope
        And they cannot see any banner
        Then "calvin" is logged in
        Then banner is deleted