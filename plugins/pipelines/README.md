# Pipelines Plugin
> Hapi pipelines plugin for the Screwdriver API

## Usage

### Register plugin

```javascript
const Hapi = require('hapi');
const server = new Hapi.Server();
const pipelinesPlugin = require('./');
const Datastore = require('your-datastore-here');

server.connection({ port: 3000 });

server.register({
    register: pipelinesPlugin,
    options: {
        datastore: new Datastore(),
        password: 'this_is_a_password_that_needs_to_be_atleast_32_characters'
    }
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

#### Get all pipelines
`page` and `count` optional

`GET /pipelines?page={pageNumber}&count={countNumber}`

#### Get single pipeline

`GET /pipelines/{id}`

#### Update a pipeline

`PUT /pipelines/{id}`

**Arguments**

* `scmUrl` - Source code URL for the application. For a git-based repository, it is typically the SSH endpoint and the
branch name, separated by a octothorpe.
* `configUrl` - *Optional* Source code URL for Screwdriver configuration, if it is in a different location than the
source code. For a git-based repository, it is typically the SSH endpoint and the branch name, separated by a octothorpe.

Example payload:
```json
{
  "scmUrl": "git@github.com:screwdriver-cd/data-model.git#master",
  "configUrl": "git@github.com:screwdriver-cd/optional-config.git#master",
}
```

#### Create a pipeline
Create a pipeline and create a job called 'main'

`POST /pipelines`

**Arguments**

* `scmUrl` - Source code URL for the application. For a git-based repository, it is typically the SSH endpoint and the
branch name, separated by a octothorpe. Must be unique.
* `configUrl` - *Optional* Source code URL for Screwdriver configuration, if it is in a different location than the
source code. For a git-based repository, it is typically the SSH endpoint and the branch name, separated by a octothorpe.

Example payload:
```json
{
  "scmUrl": "git@github.com:screwdriver-cd/data-model.git#master",
  "configUrl": "git@github.com:screwdriver-cd/optional-config.git#master"
}
```
