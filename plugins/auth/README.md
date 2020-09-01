# Authentication Plugin
> Hapi auth plugin for the Screwdriver API

## Usage

### Register plugin

```javascript
const Hapi = require('@hapi/hapi');
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

#### Login (and redirect to token)

This will generate a cookie with the JWT in it.

 - OAuth: `GET /auth/login/{scmContext}` or `POST /auth/login/{scmContext}`
 - Token: `GET /auth/login/key?token=YOUR_API_TOKEN`
 - Guest: `GET /auth/login/guest`

#### Get a token

`GET /auth/token` (with OAuth) or `GET /auth/token?api_token=YOUR_API_TOKEN` (with API token)

#### Get a public key for verifying JSON Web Tokens (JWTs)

`GET /auth/key`

#### Logout

`POST /auth/logout`

#### Get all scm contexts

`GET /auth/contexts`
