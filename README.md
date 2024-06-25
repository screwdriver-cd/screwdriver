### This forked project has a debloated version of package.json file, which execludes the unnecessary direct dependencies in testing runtime.


# Screwdriver API
[![Version][npm-image]][npm-url] [![Pulls][docker-pulls]][docker-url] [![Stars][docker-stars]][docker-url] [![Build Status][status-image]][status-url] [![Open Issues][issues-image]][issues-url] [![Coverage][cov-image]][cov-url] [![Vulnerabilities][vul-image]][vul-url] ![License][license-image] [![Slack][slack-image]][slack-url] [![CII Best Practices](https://bestpractices.coreinfrastructure.org/projects/4689/badge)](https://bestpractices.coreinfrastructure.org/projects/4689)

> API for the Screwdriver CD service

[Screwdriver](http://screwdriver.cd) is a self-contained, pluggable service to help you build, test, and continuously deliver software using the latest containerization technologies.

## Table of Contents

- [Background](#background)
- [Installation and Usage](#installation-and-usage)
- [Configuration](#configuration)
- [Testing](#testing)
- [Contribute](#contribute)
- [License](#license)

## Background

Screwdriver began as a hack for simplified interfacing with Jenkins at Yahoo in 2012. As the volume of builds increased, it became clear that Jenkins was not stable or feasible to use at the scale we were running builds. In 2016, we rebuilt Screwdriver from scratch in open source with our best coding practices and CICD goals in mind. Screwdriver is executor and SCM-agnostic, meaning you can choose whichever plugin better suits your need or build your own. It's completely free and open source, and our team is actively maintaining the code.

For more information about Screwdriver, check out our [homepage](http://screwdriver.cd).

## Installation and Usage

### Plugins

This API comes preloaded with 18 (eighteen) resources:

 - [auth](plugins/auth/README.md)
 - [banners](plugins/banners/README.md)
 - [builds](plugins/builds/README.md)
 - [buildClusters](plugins/buildClusters/README.md)
 - [collections](plugins/collections/README.md)
 - [commands](plugins/commands/README.md)
 - [coverage](plugins/coverage/README.md) - optional
 - [events](plugins/events/README.md)
 - [jobs](plugins/jobs/README.md)
 - [pipelines](plugins/pipelines/README.md)
 - [secrets](plugins/secrets/README.md)
 - [stages](plugins/stages/README.md)
 - [stageBuilds](plugins/stageBuilds/README.md)
 - [templates](plugins/templates/README.md)
 - [tokens](plugins/tokens/README.md)
 - [webhooks](plugins/webhooks/README.md)
 - [stats](plugins/stats.js)
 - [isAdmin](plugins/isAdmin.js)

Three (3) option for datastores:
 - Postgres, MySQL, and Sqlite (`sequelize`)

Three (3) options for executor:
 - Kubernetes (`k8s`)
 - Docker (`docker`)
 - Nomad (`nomad`)

Three (3) options for SCM:
 - GitHub (`github`)
 - GitLab (`gitlab`)
 - Bitbucket (`bitbucket`)

### Prerequisites
To use Screwdriver, you will need the following prerequisites:

- Node v12.0.0 or higher
- [Kubernetes][kubectl] or [Docker][docker]

### From Source

```bash
$ git clone git@github.com:screwdriver-cd/screwdriver.git ./
$ npm install
$ vim ./config/local.yaml # See below for configuration
$ npm start
info: Server running at http://localhost:8080
```

### From a Prebuilt Docker image

```bash
$ vim ./local.yaml # See below for configuration
$ docker run --rm -it --volume=`pwd`/local.yaml:/config/local.yaml -p 8080 screwdrivercd/screwdriver:stable
info: Server running at http://localhost:8080
```

### Using In-A-Box

Our in-a-box script brings up an entire Screwdriver instance (ui, api, and log store) locally for you to play with.
Follow instructions at https://github.com/screwdriver-cd/in-a-box#screwdriver-in-a-box.

### Using Helm

[This chart](https://github.com/screwdriver-cd/screwdriver-chart) bootstraps the whole Screwdriver ecosystem and also nginx ingress controller.

## Configuration

Screwdriver already [defaults most configuration](config/default.yaml), but you can override defaults using a `local.yaml` or environment variables.

To continue set up, follow the [instructions for cluster management](https://github.com/screwdriver-cd/guide/blob/master/docs/cluster-management/configure-api.md#managing-the-api).

### Yaml

Example overriding `local.yaml`:

```yaml
executor:
    plugin: k8s
    k8s:
        options:
            kubernetes:
                host: kubernetes.default
                token: this-is-a-real-token
            launchVersion: stable

scms:
    github:
        plugin: github
        config:
            oauthClientId: totally-real-client-id
            oauthClientSecret: another-real-client-secret
            secret: a-really-real-secret
            username: sd-buildbot
            email: dev-null@screwdriver.cd
```

### Environment

Example overriding with environment variables:

```bash
$ export K8S_HOST=127.0.0.1
$ export K8S_TOKEN=this-is-a-real-token
$ export SECRET_OAUTH_CLIENT_ID=totally-real-client-id
$ export SECRET_OAUTH_CLIENT_SECRET=another-real-client-secret
```

All the possible environment variables are [defined here](config/custom-environment-variables.yaml).

## Testing

### Unit Tests

```bash
npm test
```

_Note: You might run into [memory issues running all the unit tests](https://stackoverflow.com/questions/26094420/fatal-error-call-and-retry-last-allocation-failed-process-out-of-memory/48895989#48895989). You can update your `~/.bashrc` file with the line below to ensure there's enough memory for tests to run:_

```bash
export NODE_OPTIONS=--max_old_space_size=4096
```

### Functional tests

Fork `functional-*` repositories to your organization from [screwdriver-cd-test](https://github.com/screwdriver-cd-test)

#### With `.func_config`

Add `.func_config` to the root of the Screwdriver API folder with your username, github token, access key, host, and organization for test:
```
GIT_TOKEN=YOUR-GITHUB-TOKEN
SD_API_TOKEN=YOUR-SD-API-TOKEN
SD_API_HOST=YOUR-SD-API-HOST
SD_API_PROTOCOL=PROTOCOL-FOR-SD-API // e.g.PROTOCOL=http; by default it is https
TEST_ORG=YOUR-TEST-ORGANIZATION
TEST_USERNAME=YOUR-GITHUB-USERNAME
TEST_SCM_HOSTNAME=YOUR-TEST-SCM-HOSTNAME // e.g. TEST_SCM_HOSTNAME=mygithub.com; by default it is github.com
TEST_SCM_CONTEXT=YOUR-TEST-SCM-CONTEXT // e.g.TEST_SCM_CONTEXT=bitbucket; by default it is github
```

#### With environment variables

Set the environment variables:

```bash
$ export GIT_TOKEN=YOUR-GITHUB-TOKEN
$ export SD_API_TOKEN=YOUR-SD-API-TOKEN
$ export SD_API_HOST=YOUR-SD-API-HOST
$ export SD_API_PROTOCOL=PROTOCOL-FOR-SD-API
$ export TEST_ORG=YOUR-TEST-ORGANIZATION
$ export TEST_USERNAME=YOUR-GITHUB-USERNAME
$ export TEST_SCM_HOSTNAME=YOUR-TEST-SCM-HOSTNAME
$ export TEST_SCM_CONTEXT=YOUR-TEST-SCM-CONTEXT
```

Then run the cucumber tests:
```bash
npm run functional
```

## Contribute
To start contributing to Screwdriver, have a look at our guidelines, as well as pointers on where to start making changes, in our [contributing guide](http://docs.screwdriver.cd/about/contributing).

## License

Code licensed under the BSD 3-Clause license. See [LICENSE file](https://github.com/screwdriver-cd/screwdriver/blob/master/LICENSE) for terms.

[npm-image]: https://img.shields.io/npm/v/screwdriver-api.svg
[npm-url]: https://npmjs.org/package/screwdriver-api
[cov-image]: https://coveralls.io/repos/github/screwdriver-cd/screwdriver/badge.svg?branch=master
[cov-url]: https://coveralls.io/github/screwdriver-cd/screwdriver?branch=master
[vul-image]: https://snyk.io/test/github/screwdriver-cd/screwdriver.git/badge.svg
[vul-url]: https://snyk.io/test/github/screwdriver-cd/screwdriver.git
[docker-pulls]: https://img.shields.io/docker/pulls/screwdrivercd/screwdriver.svg
[docker-stars]: https://img.shields.io/docker/stars/screwdrivercd/screwdriver.svg
[docker-url]: https://hub.docker.com/r/screwdrivercd/screwdriver/
[license-image]: https://img.shields.io/npm/l/screwdriver-api.svg
[issues-image]: https://img.shields.io/github/issues/screwdriver-cd/screwdriver.svg
[issues-url]: https://github.com/screwdriver-cd/screwdriver/issues
[status-image]: https://cd.screwdriver.cd/pipelines/1/badge
[status-url]: https://cd.screwdriver.cd/pipelines/1
[slack-image]: http://slack.screwdriver.cd/badge.svg
[slack-url]: http://slack.screwdriver.cd/
[docker-compose]: https://www.docker.com/products/docker-compose
[nomad]: https://www.hashicorp.com/products/nomad
[docker]: https://www.docker.com/products/docker
[kubectl]: https://kubernetes.io/docs/user-guide/kubectl-overview/
