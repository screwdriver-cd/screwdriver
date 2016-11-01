# CHANGELOG

## 3.4.0

Features:
  * Create an event when creating a build
  * Add eventId to the build

## 3.3.0

Breaking changes:
  * Webhooks endpoint is decoupled from Github and generic for different SCM provider
  * The new webhooks endpoint is `POST /webhooks`
  * Signing secret for github is moved to under github scm plugin in config yaml