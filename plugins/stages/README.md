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

#### Get single stage

`GET /stages/{id}`

#### Get a listing of all stage builds for a stage

`GET /stages/{id}/stageBuilds`
`GET /stages/{id}/stageBuilds?eventId={eventId}`
