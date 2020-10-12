# Webhooks Plugin
> Hapi webhooks plugin for the Screwdriver API

## Usage

### Register plugin

```javascript
const Hapi = require('@hapi/hapi');
const server = new Hapi.Server();
const webhooksPlugin = require('./');

server.connection({ port: 3000 });

server.register({
    register: Plugin,
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

#### Post webhooks events
Follow instructions from your SCM provider to set up webhooks for your repository or organization:  

`POST /webhooks`

