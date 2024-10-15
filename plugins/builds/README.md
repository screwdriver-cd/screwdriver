# Builds Plugin
> Hapi builds plugin for the Screwdriver API

## Usage
```javascript
const Hapi = require('@hapi/hapi');
const server = new Hapi.Server();
const buildsPlugin = require('./');

server.connection({ port: 3000 });

server.register({
    register: buildsPlugin,
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

#### Returns a single build
`GET /builds/{id}`

#### Returns a Stream of logs
`GET /builds/{id}/steps/{name}/logs?from=0&pages=10&sort=descending`

Arguments:

* `from` - Line number to start loading lines from
* `pages` - Number of pages to load; a page is 100 lines
* `sort` - Order in which to fetch logs (`ascending` or `descending`), default `ascending`

#### Gets a build step
`GET /builds/{id}/steps/{name}`

#### List the build step by status
`GET /builds/{id}/steps`

Arguments:

* `status` - Status to filter by

`GET /builds/{id}/steps?status=active`

`GET /builds/{id}/steps?status=failure`

`GET /builds/{id}/steps?status=success`

#### Updates a build step
`PUT /builds/{id}/steps/{name}`

Example payload:
```json
{
    "code": 0,
    "startTime": "2038-01-19T03:15:08.131Z",
    "endTime": "2038-01-19T03:15:08.532Z",
    "lines": 100
}
```

#### Gets all build artifacts as ZIP file
`GET /builds/{id}/artifacts`

#### Gets a build artifact or directory as ZIP file
`GET /builds/{id}/artifacts/{name*}`

Arguments:

* `type` - Return type for build artifact, `download` or `preview`

`GET /builds/{id}/artifacts/{name*}?type=preview`

`GET /builds/{id}/artifacts/this/is/a/directory/path/?type=download`

*Note: To download a directory, there must be a trailing slash (`/`) in the name and `type=download`.*

#### Get build statuses
`GET /builds/statuses`

`GET /builds/statuses?jobIds=1&jobIds=2&numBuilds=3&offset=0`

Arguments:

* `jobIds` - Job IDs for builds to fetch
* `numBuilds` - Number of builds to load (default 1)
* `offset` - Number of build statuses to skip (default 0)

#### Updates a build
`PUT /builds/{id}`

Example payload:
```json
{
    "status": "FAILURE"
}
```

#### Get step metrics for a single build
`GET /builds/{id}/metrics`

`GET /builds/{id}/metrics?startTime=2019-02-01T12:00:00.000Z`

`GET /builds/{id}/metrics?startTime=2019-02-01T12:00:00.000Z&endTime=2019-03-01T12:00:00.000`

### Access to Factory methods
The server supplies factories to plugins in the form of server app values:

```js
// handler in buildsPlugin.js
handler: async (request, h) => {
    const factory = request.server.app.buildFactory;

    // ...
}
```
