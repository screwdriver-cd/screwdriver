# Collections Plugin
> API Collections plugin for the Screwdriver API

## Usage

### Register plugin

```js
const Hapi = require('@hapi/hapi');
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

#### Get a list of collections belonging to the requesting user

`GET /collections`

#### Get a single collection

`GET /collections/{id}`

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

#### Update a collection
You can update the name, description, or pipelineIds of a collection.

`PUT /collections/{id}`

**Arguments**

* `name` - An optional new name for the collection. Names must be unique.
* `description` - An optional new description for the collection.
* `pipelineIds` - An optional new array of ids of pipelines for the collection.

Example payload:
```json
{
    "name": "foo",
    "description": "bar",
    "pipelineIds": [1, 2, 5]
}
```

#### Add one or more pipelines to a collection

`PUT /collections/{id}/pipelines?ids[]={pipelineId}`

Examples:

`PUT /collections/123/pipelines?ids[]=11&ids[]=23` adds pipelines with `id` equal to `11` and `23` to the collection with `id` equal to `123`


#### Remove one or more pipelines from a collection

`DELETE /collections/{id}/pipelines?ids[]={pipelineId}`

Examples:

`DELETE /collections/123/pipelines?ids[]=11&ids[]=23` removes pipelines with `id` equal to `11` and `23` from the collection with `id` equal to `123`

`DELETE /collections/123/pipelines` removes all the pipelines from the collection with `id` equal to `123`

#### Delete a collection

`DELETE /collections/{id}`
