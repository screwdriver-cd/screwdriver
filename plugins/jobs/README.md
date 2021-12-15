# Jobs Plugin
> Hapi jobs plugin for the Screwdriver API

## Usage

```javascript
const Hapi = require('@hapi/hapi');
const server = new Hapi.Server();
const jobsPlugin = require('./');

server.connection({ port: 3000 });

server.register({
    register: jobsPlugin,
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

#### Returns a single job
`GET /jobs/{id}`

#### Updates a single job
`PUT /jobs/{id}`

Arguments:

* `state` - Current state of the job. Could be `ENABLED` or `DISABLED`.

Example payload:
```json
{   
    "state": "ENABLED"
}
```

#### Get list of builds for a single job
`GET /jobs/{id}/builds`

`GET /jobs/{id}/builds?steps=true`

`GET /jobs/{id}/builds?page=2&count=30&sort=ascending`

`GET /jobs/{id}/builds?page=2&count=30&sort=ascending&sortBy=id`

#### Get latest build for a single job
`GET /jobs/{id}/latestBuild`

Can search by build status
`GET /jobs/{id}/latestBuild?status=SUCCESS`

#### Get build metrics for a single job
`GET /jobs/{id}/metrics/builds`

`GET /jobs/{id}/metrics/builds?startTime=2019-02-01T12:00:00.000Z`

`GET /jobs/{id}/metrics/builds?startTime=2019-02-01T12:00:00.000Z&endTime=2019-03-01T12:00:00.000`

#### Get step metrics for a single job
`GET /jobs/{id}/metrics/steps/sd-setup-scm`

### Access to Factory methods
The server supplies factories to plugins in the form of server app values:

```js
// handler jobsPlugin.js
handler: async (request, h) => {
    const factory = request.server.app.jobFactory;

    // ...
}
```
