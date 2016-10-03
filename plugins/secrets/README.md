# Secrets Plugin
> Hapi secrets plugin for the Screwdriver API

## Usage

### Register plugin

```javascript
const Hapi = require('hapi');
const server = new Hapi.Server();
const secretsPlugin = require('./');

server.connection({ port: 3000 });

server.register({
    register: secretsPlugin,
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
`Get` requires **write** permission to the repository.

`Create`, `Remove` and `Update` require **admin** permission to the repository.

#### Get a secret

`GET /secrets/{id}`

#### Create a secret

`POST /secrets`

**Arguments**

* `pipelineId` - Pipeline that this secret belongs to.
* `name` - Name of the secret. The name should match the pattern `/^[A-Z_][A-Z0-9_]*$/`.
* `value` - Value of the secret.
* `allowInPR` - Flag to denote if this secret can be shown in PR builds.

Example payload:
```json
{
  "pipelineId": "d398fb192747c9a0124e9e5b4e6e8e841cf8c71c",
  "name": "NPM_TOKEN",
  "value": "batman",
  "allowInPR": true
}
```
#### Remove a secret

`DELETE /secrets/{id}`

#### Update a secret

`PUT /secrets/{id}`

**Arguments**

Only `value` and `allowInPR` can be updated.

* `value` - Value of the secret.
* `allowInPR` - Flag to denote if this secret can be shown in PR builds.

Example payload:
```json
{
  "value": "batman",
  "allowInPR": true
}
```

### Access to Factory methods
The server supplies factories to plugins in the form of server settings:

```js
// handler secretPlugin.js
handler: (request, reply) => {
    const factory = request.server.app.secretFactory;

    // ...
}
```
