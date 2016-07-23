# Builds Plugin
> Hapi builds plugin for the Screwdriver API

## Usage
```javascript
const Hapi = require('hapi');
const server = new Hapi.Server();
const buildsPlugin = require('./');
const Datastore = require('your-datastore-here');
const Executor = require('your-executor-here');

server.connection({ port: 3000 });

server.register({
    register: buildsPlugin,
    options: {
        datastore: new Datastore(),
        executor: new Executor({
            executorOption1: 'hostname'
        })
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
#### Lists builds with pagination
`page` and `count` are optional

`GET /builds?page={page}&count={count}`

#### Returns a single build
`GET /builds/{id}`

#### Returns a Stream of logs
`GET /builds/{id}/logs`

#### Creates a build
`POST /builds`

Example payload:
```json
    {
        "jobId": "d398fb192747c9a0124e9e5b4e6e8e841cf8c71c",
        "container": "node:6"
    }
```

#### Updates a build
`PUT /builds/{id}`

Example payload:
```json
    {
        "status": "FAILURE"
    }
```
