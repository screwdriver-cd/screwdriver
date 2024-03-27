# Stages Plugin
> API stages plugin for the Screwdriver API

## Usage

### Register plugin

```javascript
const Hapi = require('@hapi/hapi');
const server = new Hapi.Server();
const stagesPlugin = require('./');

server.connection({ port: 3000 });

server.register({
    register: stagesPlugin,
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

#### Get all stages
`page`, `count`, `sort`, `sortBy`, `name`, `pipelineId`, and `jobIds` optional

`GET /stages?page={pageNumber}&count={countNumber}&pipelineId={pipelineId}&name={stageName}`

Need to have array format for `jobIds` to only return stages with matching ids
`GET /stages?jobIds[]=12345&jobIds[]=55555`

#### Get single stage

`GET /stages/{id}`

#### Get a listing of all stage builds for a stage

`GET /stages/{id}/stageBuilds`
