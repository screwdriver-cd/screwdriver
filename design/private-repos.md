# Screwdriver Access to Private Repositories

## Context
Provide a way for users to create and execute a pipeline for a private GitHub repository.

This documentation covers the design proposal for that new feature.

## Status

- Oct 10, 2018: Design document

## The Problem

The current authentication methods do not provide access to private repositories.  This includes
GitHub API calls as well as git clones via SSH.

The OAuth token provided today for GitHub API calls is limited in scope to only public repositories.  If this scope were to 
be expanded, then all users (whether they need this expanded scope or not) would be granting Screwdriver
a security scope larger than required.  The screwdriver app should only be granted scope
that is required.
There are several stages of a Screwdriver pipeline in which this expanded scope is required
when dealing with private repositories.  This document will outline each stage and how it will be addressed.

Additionally, the Screwdriver app only has access to clone public repositories with the ssh key
currently being used by Screwdriver.

## Background

Reference [Issue 1079][issue1079]

## Proposal
Any user intending to use Screwdriver with private repositories must perform the following prerequisites:
- create a Personal Access Token within the Developer Settings of their Github user profile
and include that token into their Screwdriver user profile.
	- Github Personal Access Token is created at: https://github.com/settings/tokens/new
	- Screwdriver user profile is edited at:  /user-settings
- create/obtain an ssh keypair 
	- store the public key within the Deploy Keys section of the private repository settings 
	- associate the private key with the Screwdriver pipeline associated with this private repository

Private Repository Pipeline Creation:
1 A GitHub Personal Access Token that allows control of private repositories must be associated to the user profile within Screwdriver.
1 User indicates on the Create form that the repository is a private repository which expands the web form to ask for additional information.
1 User adds the private ssh key associated with the private repository to the Pipeline Create webform.

The private ssh key will be stored as a Secret on the pipeline at pipeline creation time.  This Secret will be named [TBD]. 
The existence of the secret with name [TBD] will essentially be a flag that indicates that this is a
private repository requiring special handling.
- When Screwdriver attempts to perform API calls for a private repository pipeline, it will use this flag to know to use the 
GitHub Personal Access Token associated with the user logged in.
- When Screwdriver attempts to clone the repository for a private repository pipeline, it will use this flag to know to use the
private ssh key that was associated to the pipeline.

Screwdriver features that are affected by these changes are:
- Creating/updating the pipeline (API calls)
- Creating/updating the webhook (API calls)
- Managing secrets (API calls)
- Executing a build job (API calls and Cloning repo)

Anticipated problem not resolved by this implementation:
- A Pipeline leveraging Repo and multiple private repositories would not work with the above design.
GitHub requires a unique public SSH key per repository and the above design only supports defining one private key per Pipeline.

## Contributing

If you make changes to the design, please update this document.

## Resources

- [Issue 1079][issue1079]

[issue1079]: https://github.com/screwdriver-cd/screwdriver/issues/1079
