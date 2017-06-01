# Tokens Plugin
> API Tokens plugin for the Screwdriver API

## Usage

### Register plugin

```javascript
const Hapi = require('hapi');
const server = new Hapi.Server();
const tokensPlugin = require('./');

server.connection({ port: 3000 });

server.register({
    register: tokensPlugin,
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

#### Get a list of tokens belonging to the currently signed-in user

`GET /tokens`

#### Create a token

`POST /tokens`

**Arguments**

* `name` - Name of the token. Names must be unique.
* `description` - An optional description of what the token is used for.

Example payload:
```json
{
  "name": "Mobile Token",
  "description": "Token for use by a mobile app"
}
```

#### Update a token

`PATCH /tokens/{id}`

**Arguments**

* `name` - Optional new name for the token. Names must be unique.
* `description` - An optional description of what the token is used for.

Example payload:
```json
{
  "name": "A new name",
  "description": "This is the same token as before, but with a new name and description"
}
```

#### Remove a token

`DELETE /tokens/{id}`

### Access to Factory methods
The server supplies factories to plugins in the form of server settings:

```js
// handler tokenPlugin.js
handler: (request, reply) => {
    const factory = request.server.app.tokenFactory;

    // ...
}
```
