# Platforms Plugin
> Hapi platforms plugin for Screwdriver API

## Usage

```javascript
const Hapi = require('hapi');
const server = new Hapi.Server();
const platformsPlugin = require('./');
const Datastore = require('your-datastore-here');

server.connection({ port: 3000 });

server.register({
    register: platformsPlugin,
    options: {
        datastore: new Datastore()
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
#### Lists platforms with pagination
*`page` and `count` are optional*

`GET /platforms?page={page}&count={count}`

#### Returns a single platform
`GET /platforms/{id}`

#### Updates a single platform
`PUT /platforms/{id}`

Example payload:
```json
{
    "experimental": false
}
```

#### Creates a single platform
`POST /platforms`

*`docUrl` and `experimental` are optional*

Example payload:
```json
{
    "name": "nodejs_app",
    "version": "1.0.0",
    "config": {},
    "author": "batman",
    "scmUrl": "git@github.com:screwdriver-cd/data-model.git",
    "docUrl": "http://blah.com",
    "experimental": false
}
```
