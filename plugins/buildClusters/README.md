# Build Clusters Plugin
> API build clusters plugin for the Screwdriver API

## Usage

### Register plugin

```javascript
const Hapi = require('hapi');
const server = new Hapi.Server();
const buildClustersPlugin = require('./');

server.connection({ port: 3000 });

server.register({
    register: buildClustersPlugin,
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

#### Create a buildCluster

`POST /buildclusters`

Example payload:
```json
{
    "name": "iOS",
    "scmOrganizations": ["screwdriver-cd"],
    "managedByScrewdriver": false,
    "maintainer": "foo@bar.com",
    "isActive": true,
    "description": "Build cluster for iOS team",
    "weightage": 100
}
```

#### Get a listing of all buildClusters

`GET /buildclusters`

#### Get a specific buildCluster

`GET /buildclusters/{id}`

#### Update a specific buildCluster

`PUT /buildclusters/{id}`

**Arguments**

* `message` - An optional new string of text for the buildCluster.
* `type` - An optional new buildCluster type. Options are `info` and `warn`
* `isActive` - An optional new status flag to indicate whether buildCluster should display.

Example payload:
```json
{
    "message": "The Screwdriver Team has resolved the random failure issue.",
    "type": "info",
    "isActive": "true"
}
```

#### Delete a specific buildCluster

`DELETE /buildclusters/{id}`
