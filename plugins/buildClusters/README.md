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

`GET /buildclusters/{name}`

#### Delete a specific buildCluster

`DELETE /buildclusters/{name}`
