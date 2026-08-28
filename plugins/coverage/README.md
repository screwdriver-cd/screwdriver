# Coverage Plugin
> Hapi coverage plugin for the Screwdriver API

## Usage

```javascript
const Hapi = require('@hapi/hapi');
const server = new Hapi.Server();
const coveragePlugin = require('./');

server.connection({ port: 3000 });

server.register({
    register: coveragePlugin,
    options: {}
}, () => {
    server.start((err) => {
        if (err) {
            throw err;
        }
        console.log('Server running at:', server.info.uri);
    });
});

```

### Routes

#### Returns an access token to talk to coverage server
`GET /coverage/token?projectKey=job:123`

`scope`, `projectName`, and `username` are not accepted as query parameters — all three are always resolved
server-side from the build's own JWT-verified identity. `projectKey` is rejected with a `403` unless it
names a project the calling build is authorized for (its own pipeline, its own job, or its PR parent job)
**and** matches the build's own resolved coverage scope.

> **Deployment order:** requires `screwdriver-coverage-sonar` ≥6.0.0
> ([coverage-sonar#80](https://github.com/screwdriver-cd/coverage-sonar/pull/80)). This API change must be
> deployed *before* that dependency is bumped — see that PR's README for why.

#### Get an object with coverage info

`GET /coverage/info?pipelineId=1&jobId=123&startTime=2017-10-19T13%3A00%3A00%2B0200&endTime=2017-10-19T15%3A00%3A00%2B0200&jobName=main&pipelineName=d2lam%2Fmytest&scope=pipeline&prNum=555&prParentJobId=456`

Should resolve with something like
```javascript
{
    coverage: '98.8',
    projectUrl: 'https://sonar.screwdriver.cd/dashboard?id=job%3A123'
}
```
