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

#### Returns a single build
`GET /builds/{id}`

#### Returns a Stream of logs
`GET /builds/{id}/steps/{name}/logs?from=0&pages=10&sort=descending`

Arguments:

* `from` - Line number to start loading lines from
* `pages` - Number of pages to load; a page is 100 lines
* `sort` - Order in which to fetch logs (`ascending` or `descending`), default `ascending`

#### Creates a build
`POST /builds`

Example payload:
```json
{
    "jobId": "d398fb192747c9a0124e9e5b4e6e8e841cf8c71c"
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
