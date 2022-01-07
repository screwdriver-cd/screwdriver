# Process Hooks Plugin
> Hapi processHooks plugin for the Screwdriver API

## Usage

### Register plugin

```javascript
const Hapi = require('@hapi/hapi');
const server = new Hapi.Server();
const processHooksPlugin = require('./');

server.connection({ port: 3000 });

server.register({
    register: processHooksPlugin,
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

#### Start pipeline events from scm webhook config

`POST /processHooks`

