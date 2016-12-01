# Contributing

Thank you for considering contributing! There are many ways you can help.

## Issues

File an issue if you think you've found a bug. Be sure to describe

1. How can it be reproduced?
2. What did you expect?
3. What actually occurred?
4. Version, platform, etc. if possibly relevant.

## Docs

Documentation, READMEs, and examples are extremely important. Please help improve them and if you find a typo or notice a problem, please send a fix or say something.

## Submitting Patches

Patches for fixes, features, and improvements are accepted through pull requests.

* Write good commit messages, in the present tense! (Add X, not Added X). Short title, blank line, bullet points if needed. Capitalize the first letter of the title or bullet item. No punctuation in the title.
* Code must pass lint and style checks.
* All external methods must be documented.
* Include tests to improve coverage and prevent regressions.
* Squash changes into a single commit per feature/fix. Ask if you're unsure how to discretize your work.

Please ask before embarking on a large improvement so you're not disappointed if it does not align with the goals of the project or owner(s).

## Commit message format

We use [semantic-release](https://www.npmjs.com/package/semantic-release), which requires commit messages to be in this specific format: `<type>(<scope>): <subject>`

* Types:
  * feat (feature)
  * fix (bug fix)
  * docs (documentation)
  * style (formatting, missing semi colons, …)
  * refactor
  * test (when adding missing tests)
  * chore (maintain)
* Scope: anything that specifies the scope of the commit. Can be blank or `*`
* Subject: description of the commit. For **breaking changes** that require major version bump, add `BREAKING CHANGE` to the commit message.

**Examples commit messages:**
* Bug fix: `fix: Remove extra space`
* Breaking change: `feat(scm): Support new scm plugin. BREAKING CHANGE: github no longer works`

## Feature Requests

Make the case for a feature via an issue with a good title. The feature should be discussed and given a target inclusion milestone or closed.
