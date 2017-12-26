# Commands Plugin
> Hapi commands plugin for the Screwdriver API

## Usage

### Register plugin

```javascript
const Hapi = require('hapi');
const server = new Hapi.Server();
const commandsPlugin = require('./');

server.connection({ port: 3000 });

server.register({
    register: commandsPlugin,
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

#### Command

##### Get a single command

You can get a single command by providing the command namespace, name and the specific version or the tag.

`GET /commands/{namespace}/{name}/{tag}` or `GET /commands/{namespace}/{name}/{version}`

###### Arguments

'namespace', 'name', 'tag' or 'version'

* `namespace` - Namespace of the command
* `name` - Name of the command
* `tag` - Tag of the command (e.g. `stable`, `latest`, etc)
* `version` - Version of the command

##### Create a command

Creating a command will store the command data (`namespace`, `name`, `version`, `description`, `maintainer`, `format`, `commandFormat`) into the datastore.

`version` will be auto-bumped. For example, if `foo/bar@1.0.0` already exists and the version passed in is `1.0`, the newly created command will be version `1.0.1`. 

*Note: This endpoint will be only accessible in `build` scope and the permission is tied to the pipeline that first creates the command in the near future.*

`POST /commands`

###### Arguments

'namespace', 'name', 'version', 'description', 'maintainer', 'format', commandFormat (`habitat` or `docker` or `binary`)

* `namespace` - Namespace of the command
* `name` - Name of the command
* `version` - Version of the command
* `description` - Description of the command
* `maintainer` - Maintainer of the command
* `format` - `habitat` or `docker` or `binary`
* `habitat` or `docker` or `binary` - Config of the command. This field is an object that includes properties of each command format.

Example payload:
```json
{
  "namespace": "foo",
  "name": "bar",
  "version": "1.7",
  "description": "this is a command",
  "maintainer": "foo@bar.com",
  "format": "habitat",
  "habitat": {
     "mode": "remote",
     "package": "core/git/2.14.1",
     "command": "git"
  }
}
```

