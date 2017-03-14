# Templates Plugin
> Hapi templates plugin for the Screwdriver API

## Usage

### Register plugin

```javascript
const Hapi = require('hapi');
const server = new Hapi.Server();
const templatesPlugin = require('./');

server.connection({ port: 3000 });

server.register({
    register: templatesPlugin,
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

#### Get all templates
`page` and `count` optional

`GET /templates?page={pageNumber}&count={countNumber}`

#### Get single template

`GET /templates/{id}`

#### Create a template
Create a template will store the template data (`config`, `name`, `version`, `description`, `maintainer`, `labels`) into the datastore.

If the exact template and version already exist, the only thing that can be changed is `labels`.

If the template already exists but not the version, the new version will be stored provided that the build has correct permissions.

This endpoint is only accessible in `build` scope.

`POST /templates`

**Arguments**

'name', 'version', 'description', 'maintainer', labels

* `name` - Name of the template
* `version` - Version of the template
* `description` - Description of the template
* `maintainer` - Maintainer of the template
* `labels` - Labels of the template. This field is optional and should be an array.
* `config` - Config of the template. This field is an object that includes `steps`, `image`, and optional `secrets`, `environments`. Similar to what's inside the `job`

Example payload:
```json
{
  "name": "screwdriver/build",
  "labels": ["stable"],
  "version": "1.7.3",
  "description": "this is a template",
  "maintainer": "foo@bar.com",
  "config": {
      "steps": [{
          "echo": "echo hello"
      }]
  }
}
```
