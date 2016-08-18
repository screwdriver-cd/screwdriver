# Builds Plugin
> Hapi builds plugin for the Screwdriver API

## Usage
```javascript
const Hapi = require('hapi');
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

### Access to Factory methods
The server supplies factories to plugins in the form of server app values:

```js
// handler in buildsPlugin.js
handler: (request, reply) => {
    const factory = request.server.app.buildFactory;

    // ...
}
```
