# Commands Plugin

> Hapi commands plugin for the Screwdriver API

## Usage

### Register plugin

```javascript
const Hapi = require('@hapi/hapi');
const server = new Hapi.Server();
const commandsPlugin = require('./');

server.connection({ port: 3000 });

server.register(
    {
        register: commandsPlugin,
        options: {}
    },
    () => {
        server.start(err => {
            if (err) {
                throw err;
            }
            console.log('Server running at:', server.info.uri);
        });
    }
);
```

### Routes

#### Command

##### Get all commands

`GET /commands`

Can filter by command namespace:
`GET /commands?namespace=chef`

Can search by keyword in command name, namespace, and description:
`GET /commands?search=screwdriver`

Can list all distinct command namespaces:
`GET /commands?distinct=namespace`

Can use additional options for sorting, pagination and return total count:
`GET /commands?sort=ascending&sortBy=name&page=1&count=50&getCount=true`

##### Get all command versions

You can get all versions of commands by providing the command namespace and name.

`GET /commands/{namespace}/{name}`

##### Get a single command

You can get a single command by providing the command namespace, name and the specific version or the tag.

`GET /commands/{namespace}/{name}/{tag}` or `GET /commands/{namespace}/{name}/{version}`

###### Arguments

'namespace', 'name', 'tag' or 'version'

-   `namespace` - Namespace of the command
-   `name` - Name of the command
-   `tag` - Tag of the command (e.g. `stable`, `latest`, etc)
-   `version` - Version of the command

##### Create a command

Creating a command will store the command data (`namespace`, `name`, `version`, `description`, `maintainer`, `format`, `commandFormat`) into the datastore.

`version` will be auto-bumped. For example, if `foo/bar@1.0.0` already exists and the version passed in is `1.0`, the newly created command will be version `1.0.1`.

_Note: This endpoint only accessible in `build` scope and the permission is tied to the pipeline that first creates the command._

`POST /commands`

###### Arguments

'namespace', 'name', 'version', 'description', 'maintainer', 'format', commandFormat (`habitat` or `docker` or `binary`)

-   `namespace` - Namespace of the command
-   `name` - Name of the command
-   `version` - Version of the command
-   `description` - Description of the command
-   `maintainer` - Maintainer of the command
-   `format` - `habitat` or `docker` or `binary`
-   `habitat` or `docker` or `binary` - Config of the command. This field is an object that includes properties of each command format.

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

##### Delete a command

Deleting a command will delete a command and all of its associated tags and versions.

`DELETE /commands/{namespace}/{name}`

###### Arguments

-   `namespace` - Namespace of the command
-   `name` - Name of the command

##### Delete a version of a command

Deleting a specific version of a command also deletes the associated tags for that version.

`DELETE /commands/{namespace}/{name}/versions/{version}`

###### Arguments

-   `namespace` - Namespace of the command
-   `name` - Name of the command
-   `version` - Version of the command

#### Command Tag

Command Tag allows fetching on command version by tag. For example, command `mynamespace/mycommand@1.2.0` as `stable`.

##### Create/Update a tag

If the command tag already exists, it will update the tag with the version. If the command tag doesn't exist yet, this endpoint will create the tag.

You can also call this endpoint with tag instead of the exact version. In this case, same version will have two tags. (e.g. version 1.0.0 tagged with both latest and stable)

_Note: This endpoint is only accessible in `build` scope and the permission is tied to the pipeline that creates the command._

`PUT /commands/{namespace}/{name}/tags/{tagName}` with the following payload

-   `version` - Exact version or tag of the command (ex: `1.1.0`, `latest`)

##### Delete a tag

Delete a specific tag of a command.

`DELETE /commands/{namespace}/{name}/tags/{tagName}`

###### Arguments

-   `namespace` - Namespace of the command
-   `name` - Name of the command
-   `tagName` - Tag of the command (e.g. `stable`, `latest`, etc)
