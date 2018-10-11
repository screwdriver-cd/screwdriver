# Screwdriver API!
[![Version][npm-image]][npm-url] [![Pulls][docker-pulls]][docker-url] [![Stars][docker-stars]][docker-url] [![Build Status][status-image]][status-url] [![Open Issues][issues-image]][issues-url] [![Dependency Status][daviddm-image]][daviddm-url] [![Coverage][cov-image]][cov-url] [![Vulnerabilities][vul-image]][vul-url] ![License][license-image] [![Slack][slack-image]][slack-url]

> API for the Screwdriver CD service

Screwdriver is a self-contained, pluggable service to help you build, test, and continuously deliver software using the latest containerization technologies.

## To start using Screwdriver

For more information about Screwdriver, check out our [documentation](http://docs.screwdriver.cd).

## To start contributing to Screwdriver

Have a look at our guidelines, as well as pointers on where to start making changes, in our [contributing guide](http://docs.screwdriver.cd/about/contributing).

### Prerequisites

- Node v8.0.0 or higher
- [Kubernetes][kubectl] or [Docker][docker]


### From Source

```bash
$ git clone git@github.com:screwdriver-cd/screwdriver.git ./
$ npm install
$ vim ./config/local.yaml # See below for configuration
$ npm start
info: Server running at http://localhost:8080
```

### Prebuilt Docker image

```bash
$ vim ./local.yaml # See below for configuration
$ docker run --rm -it --volume=`pwd`/local.yaml:/config/local.yaml -p 8080 screwdrivercd/screwdriver:stable
info: Server running at http://localhost:8080
```

### In-A-Box

This handy feature will bring up an entire Screwdriver instance (ui, api, and log store) locally for you to play with.
All data written to a database will be stored in `data` directory.

Requires:
 - Python 2.7
 - Mac OSX 10.10+
 - [Docker for Mac][docker]
 - [Docker Compose 1.8.1+][docker-compose]

```bash
$ python <(curl -L https://git.io/screwdriver-box)
```

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

## Plugins

This API comes preloaded with 10 (ten) resources:

 - [auth](plugins/auth/README.md)
 - [banners](plugins/banners/README.md)
 - [builds](plugins/builds/README.md)
 - [coverage](plugins/coverage/README.md) - optional
 - [collections](plugins/collections/README.md)
 - [events](plugins/events/README.md)
 - [jobs](plugins/jobs/README.md)
 - [pipelines](plugins/pipelines/README.md)
 - [secrets](plugins/secrets/README.md)
 - [tokens](plugins/tokens/README.md)
 - [webhooks](plugins/webhooks/README.md)

One (1) option for datastores:
 - Postgres, MySQL, and Sqlite (`sequelize`)

Three (3) options for executor:
 - Kubernetes (`k8s`)
 - Docker (`docker`)
 - Nomad (`nomad`)

Two (2) options for SCM:
 - Github (`github`)
 - Bitbucket (`bitbucket`)

## Testing

### Unit Tests

```bash
npm test
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

## License

Code licensed under the BSD 3-Clause license. See LICENSE file for terms.

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
[daviddm-image]: https://david-dm.org/screwdriver-cd/screwdriver.svg?theme=shields.io
[daviddm-url]: https://david-dm.org/screwdriver-cd/screwdriver
[slack-image]: http://slack.screwdriver.cd/badge.svg
[slack-url]: http://slack.screwdriver.cd/
[docker-compose]: https://www.docker.com/products/docker-compose
[nomad]: https://www.hashicorp.com/products/nomad
[docker]: https://www.docker.com/products/docker
[kubectl]: https://kubernetes.io/docs/user-guide/kubectl-overview/
