# Authentication Plugin
> Hapi auth plugin for the Screwdriver API

## Usage

### Register plugin

```javascript
const Hapi = require('hapi');
const server = new Hapi.Server();
const authPlugin = require('./');

server.connection({ port: 3000 });

server.register({
    register: authPlugin,
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

#### Login

`GET /auth/login` or `POST /auth/login`

#### Get a token

`GET /auth/token` (with OAuth) or `GET /auth/token?access_key=YOUR_ACCESS_KEY` (with API token)

#### Get a public key for verifying JSON Web Tokens (JWTs)

`GET /auth/key`

#### Logout

`POST /auth/logout`
