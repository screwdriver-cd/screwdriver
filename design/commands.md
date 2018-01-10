# Commands (Sharing Binaries)

## Context

Currently, there's no clear way to share a binaries (or scripts) across multiple jobs.  Some people have chosen to share via git repositories, yum packages, node modules, and even docker images.  But nothing is standardized and works easily in all containers.

## Status

- 11 September 2017: Proposal submitted

## Proposal

Have a single interface for executing a versioned command (via remote binary, docker image, or habitat package) during a Screwdriver build.  Managed and discoverable through the Screwdriver interface.

This provides a single abstraction for execution of shared code.

```bash
$ sd_cmd chefdk/knife@12 search node '*:*'
$ sd_cmd nodejs/vuln_check@2 ./package.json
```

## Details

### Specification

```yaml
# Namespace for the command
namespace: foo
# Command name itself
name: bar
# Description of the command and what it does
description: |
  Lorem ipsum dolor sit amet.
# Major and Minor version number (patch is automatic)
version: 1.0
# Format the command is in (see below for examples)
# Valid options: habitat, docker, binary
format: habitat

# Habitat specific config
# if format: habitat
habitat:
    mode: remote
    package: core/git/2.14.1
    # If local
    # mode: local
    # package: ./foobar.hart
    command: git

# Docker specific config
# if format: docker
docker:
    image: chefdk:1.2.3
    # Optional, default: ""
    command: knife

# Binary specific config
# if format: binary
binary:
    file: ./foobar.sh
```

### Versioning

Published command versions must be following [semver](http://semver.org)

    [MAJOR].[MINOR].[PATCH]

This is to make it easy for people to get updates without the risk of breaking backwards compatibility.

Requesting published versions follows the semver resolution as well:

 - **X-Ranges:** `1.2.*` `1.2` `1.x` `1` `*`

    Any of x, *, or blank may be used to "stand in" for one of the numeric values in the [major, minor, patch] tuple.

 - **Tilde Ranges:** `~1.2.3` `~1.2` `~1`

    Allows patch-level changes if a minor version is specified on the comparator. Allows minor-level changes if not.

 - **Caret Ranges:** `^1.2.3` `^0.2.5` `^0.0.4`

    Allows changes that do not modify the left-most non-zero digit in the [major, minor, patch] tuple. In other words, this allows patch and minor updates for versions 1.0.0 and above, patch updates for versions 0.X >=0.1.0, and no updates for versions 0.0.X.

 - **Explicit Pinning:** `1.2.3` `1.5.3`

    Allows only that exact version number, nothing else.

 - **Tags:** `latest` `stable` `feature-abc`

    Matches the exact version number that has been assigned to that tag. Tags must start with a letter and only contain `a-z`, `0-9`, and `-`. *Note: `latest` is automatically the most recently published version.*

### Formats

When a user wants to execute the command, we need to translate that to the command's native format.  We have three proposed command formats and it can easily be extended.

For each of these, the arguments pass directly to the underlying technology.  Here is our example:

```bash
$ sd_cmd exec foo/bar@1 -baz sample
```

 - **binary** - A script or binary that can be downloaded and directly executed.

```bash
$ curl -o /opt/sd/commands/foo/bar/1.0.1 https://store/v1/commands/foo/bar/1.0.1
$ chmod +x /opt/sd/commands/foo/bar/1.0.1
$ /opt/sd/commands/foo/bar/1.0.1 -baz sample
```

 - **docker** - A docker image that can be directly run.  All `SD_*` environment variables are passed and the workspace is mounted and current working directory is set as workdir.

```bash
$ docker run --rm --interactive --env-file /tmp/sd-env  \
             --volume /opt/sd/workspace --workdir `pwd` \
             foobar-docker-image:1.0.1 -baz sample
```

 - **habitat** - Either a habitat package file or name that can be installed and executed.  The binary to execute in habitat must be specified in the command spec.

```bash
$ sudo hab pkg install foobar-habitat-package/1.0.1
$ hab pkg exec foobar-habitat-package cmd -baz sample
```

## Usage

### Execute

```bash
$ sd_cmd [exec] namespace/name@version [arguments]
```

**Input:**

 - `namespace/name` is the fully-qualified command name.
 - `version` is a semver compatible format or tag.
 - `arguments` are passed directly to the underlying format.

**Output:**

All debug logs about the command lookup and execution are stored in `$SD_ARTIFACTS_DIR/.sd/commands/namespace/name/version/timestamp.log`
### Publish

```bash
$ sd_cmd publish -f command_spec.yml
1.0.4
```

**Input:**

 - `command_spec.yml` is the command specification.

**Output:**

Version number that was published.

*Example:*

```bash
1.0.4
```

### Promote

```bash
$ sd_cmd promote namespace/name version tag
Removing 1.0.1 from tag
Promoting version to tag
```

**Input:**

 - `namespace/name` is the fully-qualified command name.
 - `version` is the exact version that you are promoting.
 - `tag` is the case-insensitive name that you are promoting to.

### List

```bash
$ sd_cmd ls namespace/name[@version]
1.0.4 - latest
1.0.3
1.0.2 - blue,red
1.0.1 - stable
```

**Input:**

 - `namespace/name` is the fully-qualified command name.
 - `version` is a semver compatible format or tag.

**Output:**

List of explicit versions matching that range with comma separated tags next to applicable tags.

*Example version:*

```bash
1.0.1
```

*Example with tags:*

```bash
1.0.1 - stable,latest
```
