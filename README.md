# Screwdriver API
# Test again
[![Version][npm-image]][npm-url] [![Pulls][docker-pulls]][docker-url] [![Stars][docker-stars]][docker-url] [![Build Status][wercker-image]][wercker-url] [![Open Issues][issues-image]][issues-url] [![Dependency Status][daviddm-image]][daviddm-url] [![Coverage][cov-image]][cov-url] [![Vulnerabilities][vul-image]][vul-url] ![License][license-image] [![Slack][slack-image]][slack-url]

> API for the Screwdriver CD service

## Usage

### Prerequisites

- Node v6.0.0 or higher

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
$ docker run --rm -it --volume=`pwd`/local.yaml:/config/local.yaml -p 8080 screwdrivercd/api:latest
info: Server running at http://localhost:8080
```

## Configuration

Screwdriver already [defaults most configuration](config/default.yaml), but you can override defaults using a `local.yaml` or environment variables.

### Yaml

Example overriding `local.yaml`:

```yaml
executor:
    plugin: k8s
    k8s:
        host: 127.0.0.1
        token: this-is-a-real-token

login:
    oauthClientId: totally-real-client-id
    oauthClientSecret: another-real-client-secret
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

This API comes preloaded with 3 (three) resources:
 - [builds](plugins/builds/README.md)
 - [jobs](plugins/jobs/README.md)
 - [pipelines](plugins/pipelines/README.md)

An (authentication/authorization)(plugins/login/README.md) plugin.

Two (2) options for datastores:
 - In-Memory Database (`imdb`)
 - Amazon DynamoDB (`dynamodb`)

One (1) option for executor:
 - Kubernetes (`k8s`)

## Testing

### Unit Tests

```bash
npm test
```

### Functional tests

Update `.func_config.json` with your own username, github_token, and jwt:
```json
{
    "username": "YOUR-GITHUB-USERNAME",
    "github_token": "YOUR-ACCESS-TOKEN",
    "jwt": "YOUR-JWT"
}
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
[wercker-image]: https://app.wercker.com/status/10229771f62f565cd62622ef56f0ca6d
[wercker-url]: https://app.wercker.com/project/bykey/10229771f62f565cd62622ef56f0ca6d
[daviddm-image]: https://david-dm.org/screwdriver-cd/screwdriver.svg?theme=shields.io
[daviddm-url]: https://david-dm.org/screwdriver-cd/screwdriver
[slack-image]: http://slack.screwdriver.cd/badge.svg
[slack-url]: http://slack.screwdriver.cd/
