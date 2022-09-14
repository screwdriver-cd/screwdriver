# Users Plugin
> API users plugin for the Screwdriver API

## Usage

### Register plugin

```javascript
const Hapi = require('@hapi/hapi');
const server = new Hapi.Server();
const usersPlugin = require('./');

server.connection({ port: 3000 });

server.register({
    register: usersPlugin,
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

#### Get a user's settings

`GET /users/{id}/settings`

#### Update a specific user's settings

`PUT /users/{id}/settings`

#### Delete all user's settings

`DELETE /users/{id}/settings`

**Arguments**

* `settings` - An optional new object with user settings.

Example payload:
```json
{
    "settings": {
        "displayJobNameLength": 25
    }
}
```
