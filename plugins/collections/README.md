# Collections Plugin
> API Collections plugin for the Screwdriver API

## Usage

### Register plugin

```js
const Hapi = require('hapi');
const server = new Hapi.Server();
const collectionsPlugin = require('./');

server.connection({ port: 3000 });

server.register({
    register: collectionsPlugin,
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

#### Create a collection

`POST /collections`

**Arguments**

* `name` - Name of the collection. Names must be unique.
* `description` - An optional description of the collection.
* `pipelineIds` - An optional array of ids of pipelines to be added to the collection.

Example payload:
```json
{
    "name": "Screwdriver",
    "description": "Collection for screwdriver related pipelines",
    "pipelineIds": [12, 35, 47, 89]
}
```
