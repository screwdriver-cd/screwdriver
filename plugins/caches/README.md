# Caches Plugin
> Hapi caches plugin for the Screwdriver API

## Usage
```javascript
const Hapi = require('hapi');
const server = new Hapi.Server();
const cachesPlugin = require('./index');

server.connection({ port: 3000 });

server.register({
    register: cachesPlugin,
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

#### Deletes cache for the given scope and id
`DELETE /caches/{scope}/{id}`

Params:

* `scope` - Scope of the cache supporting values `pipelines|jobs|events`
* `id` - The id of the cache - pipelinId/jobId/buildId

### Configuration - Reads the ecosystem
```
    ecosystem:
        store: 'https://store.screwdriver.cd'
        queue: 'https://queue.screwdriver.cd'
        cache:
            strategy: 's3'
```
Routes requests to queue if strategy is **disk** and to store if strategy is **s3**

### Access to Factory methods
The server supplies factories to plugins in the form of server app values:

```js
// handler in cachesPlugin
handler: (request, reply) => {
    const factory = request.server.app.buildClusterFactory;

    // ...
}
```
