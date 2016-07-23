# Login Plugin
> Plugin for exposing authentication routes and hapi.js auth schema

## Usage

A configuration object is used for setting up the oauth and session management providers with correct parameters:

| Config Variable        |  Description           |
| :------------- |:-------------|
| config.password      | the password used for iron encrypting |
| config.oauthClientId      | the client id used for talking to the oauth provider |
| config.oauthClientSecret | the client secret used for talking to the oauth provider |
| config.jwtPrivateKey | the key used for encrypting the jwt |
| config.https | for setting the [isSecure flag](https://github.com/hapijs/bell). Needs to be set to false if not using HTTPS |

For using the plugin in your server:
```javascript
'use strict';

const Hapi = require('hapi');
let server = new Hapi.Server();

server.connection({ port: 8000 });

server.register([{
    register: require('./'),
    options: {
        password: 'this_is_a_password_that_needs_to_be_atleast_32_characters',
        oauthClientId: '1234id5678',
        oauthClientSecret: '1234secretoauthything5678',
        jwtPrivateKey: '1234secretkeythatissupersecret5678',
        https: true
    }
}], function (err) {
    if (err) {
        throw err;
    }
});

// Example route requiring a user to be logged in
server.route({
    method: 'GET',
    path: '/home',
    config: {
        // By adding the 'session' auth strategy here, the request will
        // require that the user is logged in
        // (a.k.a server.auth.credentials is populated)
        // If not logged in, will redirect to the /login page
        auth: {
            strategies: ['token', 'session']
        },
        handler: function myAccountHandler(request, reply) {
            return reply('Home');
        }
    }
});

server.start( function (err) {
    if (err) {
        throw err;
    }
    console.log(server.info.uri);
});
```
The plugin exposes the routes:
```
GET http://localhost:8000/login
POST http://localhost:8000/login
POST http://localhost:8000/logout
```

In this example, when a user hits the route `http://localhost:8000/home` the user will be redirected to `/login` if not already authenticated.
