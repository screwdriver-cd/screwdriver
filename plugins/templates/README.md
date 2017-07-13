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

#### Get a single template

You can get a single template by providing the template name and the specific version or the tag.

`GET /templates/{name}/{tag}` or `GET /templates/{name}/{version}`

**Arguments**

'name', 'tag' or 'version'

* `name` - Name of the template
* `tag` - Tag of the template (e.g. `stable`, `latest`, etc)
* `version` - Version of the template

#### Create a template
Creating a template will store the template data (`config`, `name`, `version`, `description`, `maintainer`, `labels`) into the datastore.

If the exact template and version already exist, the only thing that can be changed is `labels`.

If the template already exists but not the version, the new version will be stored provided that the build has correct permissions.

*Note: This endpoint is only accessible in `build` scope and the permission is tied to the pipeline that first creates the template.*

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

#### Create/Update a tag for a template version

Tagging a template version allows fetching on template version by tag. For example, tag `mytemplate@1.1.0` as `stable`. 

*Note: This endpoint is only accessible in `build` scope and the permission is tied to the pipeline that creates the template.*

`PUT /templates/tags` with the following payload

* `name` - Name of the template (ex: `mytemplate`)
* `version` - Version of the template (ex: `1.1.0`)
* `tag` - Name of the tag (ex: `stable`)

#### Delete a template tag

Delete the template tag. This does not delete the template itself. 

*Note: This endpoint is only accessible in `build` scope and the permission is tied to the pipeline that creates the template.*

`DELETE /templates/tags` with the following payload

* `name` - Name of the template (ex: `mytemplate`)
* `tag` - Name of the tag (ex: `stable`)
