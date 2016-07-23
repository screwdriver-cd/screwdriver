# Jobs Plugin
> Hapi jobs plugin for the Screwdriver API

## Usage

```javascript
const Hapi = require('hapi');
const server = new Hapi.Server();
const jobsPlugin = require('./');
const Datastore = require('your-datastore-here');

server.connection({ port: 3000 });

server.register({
    register: jobsPlugin,
    options: {
        datastore: new Datastore()
    }
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
#### Lists jobs with pagination
`page` and `count` are optional

`GET /jobs?page={page}&count={count}`

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
