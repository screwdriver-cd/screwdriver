# Screwdriver yaml

## Context
There's a lot of confusion and inconsistencies in our screwdriver.yaml. It's unclear when keys should go under job configurations, settings, or annotations. There's also confusion around annotation namespacing.

This documentation covers a design proposal for screwdriver.yaml configuration.

## Status

- May 8, 2018: Proposal discussed and accepted

## The Problem

It's confusing for users trying to configure their screwdriver.yaml files to guess or figure out where keys belong. The keys are not always consistent. It's also confusing for developers where new features/keys fit in the screwdriver.yaml.

## Background

### Annotations

[Annotations][annotations] are arbitrary key-value pairs that are not validated by the [data-schema](https://github.com/screwdriver-cd/data-schema). Annotations maintained and created by Screwdriver are traditionally prefixed with `beta.screwdriver.cd/`. This was meant to indicate it was still an experimental keyword that would eventually be stabilized and moved somewhere else. It was also convenient for developers to try out new keys and features.

### Job configurations

[Job configurations][job-config] are usually vital to the job or build and are generally not nested (except `steps`).

### Settings

[Settings][settings] are for any additional build plugins. They currently only hold `notifications` plugins such as `email` and `slack`.

## Proposal

In order to make it easier or more clear, we should follow these rules when adding to the screwdriver.yaml:
- Things that are necessary to job function like `image`, `requires`, and `steps` or guaranteed to work in all cases belong in the `job configuration`; everything else should go under `annotations`.
- We should drop the `beta` from annotation names moving forward.
- The `settings` section should be deprecated; `notifications` should be moved to the root level of job configurations

Example:

| Attribute   | Section | Reasoning |
| ----------- | ------------- | --------------- |
| `blockedBy` |  job config | syntax will be something like `blockedBy: [~sd@123:main]` (similar to `requires`) so it should live in the same place |
| `buildPeriodically` | annotation | only works with executor queue plugin |
| `freezeWindow` | annotation | similar to `buildPeriodically` |
| `repoManifest` | annotation | only works with GitHub plugin |

## Contributing

If you make changes to the design, please update this document.

## Resources

- [Annotations][annotations]
- [Job configuration][job-config]
- [Screwdriver configuration][sd-config]
- [Settings][settings]

[annotations]: https://docs.screwdriver.cd/user-guide/configuration/annotations
[job-config]: https://docs.screwdriver.cd/user-guide/configuration/jobconfiguration
[sd-config]: https://docs.screwdriver.cd/user-guide/configuration/
[settings]: https://docs.screwdriver.cd/user-guide/configuration/settings
