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
User performs the following ONCE for all private repositories:

- Create a personal access token (https://github.com/settings/tokens/new)
- Add the token to their Screwdriver user profile (under "User Settings")

User performs the following for EACH private repository:

- Create an ssh key pair 
- Store the public key in Github (Settings > Deploy keys > Add deploy key)
- Create a Screwdriver pipeline for the private repository
- Within the pipeline, define a Secret named GH_DEPLOY_KEY with the value of the private key

The existence of the Secret named GH_DEPLOY_KEY will essentially be a flag that indicates that this is a
private repository requiring special handling.

When Screwdriver attempts to perform API calls for a private repository pipeline, it will use this flag to know to use the 
GitHub Personal Access Token associated with the logged in user.

Similarly, when Screwdriver attempts to clone the repository for a build, it will use this flag to know to use the
private ssh key that was associated with the pipeline.

Screwdriver features that are affected by these changes are:
- Creating/updating the pipeline (API calls)
- Creating/updating the webhook (API calls)
- Managing secrets (API calls)
- Executing a build job (API calls and Cloning repo)

## Contributing

If you make changes to the design, please update this document.

## Resources

- [Issue 1079][issue1079]

[issue1079]: https://github.com/screwdriver-cd/screwdriver/issues/1079
