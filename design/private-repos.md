# Screwdriver Access to Private Repositories

## Context
Provide a way for users to create and execute a pipeline for a private GitHub repository.

This documentation covers the design proposal for that new feature.

## Status

- Oct 10, 2018: Design document

## The Problem

The current authentication methods do not provide access to private repositories.  
Also, there are several stages of a pipeline in which different access keys are needed 
when dealing with private repositories.
This document will outline each stage and how it will be addressed.

## Background

Reference [Issue 1079][issue1079]

## Proposal

Pipeline creation:
- User must provide a GitHub Deploy Key
- User must provide a GitHub Personal Access Token

These will be stored as Secrets to be accessed later, as follows.
Note, all of the following will use the personal access token except for the clone, 
which will use the deploy key.
- Creating/updating the pipeline
- Creating/updating the webhook
- Managing secrets
- Validating permissions (such as admin access)
- Starting a build job
- Cloning the repository

## Contributing

If you make changes to the design, please update this document.

## Resources

- [Issue 1079][issue1079]

[issue1079]: https://github.com/screwdriver-cd/screwdriver/issues/1079
