# Pipelines Plugin
> Hapi pipelines plugin for the Screwdriver API

## Usage

### Register plugin

```javascript
const Hapi = require('@hapi/hapi');
const server = new Hapi.Server();
const pipelinesPlugin = require('./');

server.connection({ port: 3000 });

server.register({
    register: pipelinesPlugin,
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

#### Get all pipelines
`page`, `count`, `sort`, `sortBy`, `search`, and `configPipelineId` optional
`search` will search for a pipeline with a name containing the search keyword in the `scmRepo` field

`GET /pipelines?page={pageNumber}&count={countNumber}&configPipelineId={configPipelineId}&search={search}`

Need to have array format for `ids` to only return pipelines with matching ids
`GET /pipelines?search={search}&ids[]=12345&ids[]=55555`


#### Get single pipeline

`GET /pipelines/{id}`

#### Create a pipeline
Create a pipeline and create a job called 'main'

`POST /pipelines`

**Arguments**

* `checkoutUrl` - Source code URL for the application. For a git-based repository, it is typically the SSH endpoint and the branch name, separated by a octothorpe. Must be unique.
* `rootDir` - *Optional* Root directory where the source code lives. Default to empty string.

Example payload:
```json
{
  "checkoutUrl": "git@github.com:screwdriver-cd/data-model.git#master",
  "rootDir": "src/app/component"
}
```

#### Update a pipeline
You can update the checkoutUrl of a pipeline.

`PUT /pipelines/{id}`

**Arguments**

* `checkoutUrl` - Source code URL for the application. For a git-based repository, it is typically the SSH endpoint and the branch name, separated by a octothorpe. Must be unique.
* `rootDir` - *Optional* Root directory where the source code lives. Default to empty string.

Example payload:
```json
{
  "checkoutUrl": "git@github.com:screwdriver-cd/data-model.git#master",
  "rootDir": "src/app/component"
}
```

#### Delete a pipeline

`DELETE /pipelines/{id}`

#### Synchronize a pipeline
* Synchronize the pipeline by looking up latest screwdriver.yaml
* Create, update, or disable jobs if necessary.
* Store/update the pipeline workflowGraph

`POST /pipelines/{id}/sync`

#### Synchronize webhooks
* Synchronize webhooks for the pipeline
* Add or update webhooks if necessary

`POST /pipelines/{id}/sync/webhooks`

#### Synchronize pull requests
* Synchronize pull requests for the pipeline
* Add or update pull request jobs if necessary

`POST /pipelines/{id}/sync/pullrequests`

#### Get all pipeline events
`page`, `count`, `sort`, and `prNum` are optional
Only PR events of specified PR number will be searched when `prNum` is set

`GET /pipelines/{id}/events?page={pageNumber}&count={countNumber}&sort={sort}&prNum={prNumber}`

#### Get all jobs (including pull requests jobs)
`archived` is optional and has a default value of `false`, which makes the endpoint not return archived jobs (e.g. closed pull requests)

`GET /pipelines/{id}/jobs?archived={boolean}`

#### Get Pipeline Admin
`GET /pipelines/{id}/admin`

#### Get all triggers

`GET /pipelines/{id}/triggers`

#### Get all stages for a single pipeline

`GET /pipelines/{id}/stages`

`GET /pipelines/{id}/stages?eventId={eventId}`

#### Get all pipeline secrets

`GET /pipelines/{id}/secrets`

#### Get event metrics for a single pipeline
`GET /pipelines/{id}/metrics`

`GET /pipelines/{id}/metrics?startTime=2019-02-01T12:00:00.000Z`

`GET /pipelines/{id}/metrics?aggregateInterval=week`

Need to have array format for downtimeJobs and downtimeStatuses
`GET /pipelines/{id}/metrics?downtimeJobs[]=123&downtimeJobs[]=456&downtimeStatuses[]=ABORTED`

#### Start all child pipelines belong to this pipeline
* Start all child pipelines belong to this config pipeline all at once

`POST /pipelines/{id}/startall`

#### Create a pipeline token

`POST /pipelines/{id}/token`

#### Get all pipeline tokens

`GET /pipelines/{id}/tokens`

#### Update a pipeline token

`PUT /pipelines/{pipelineId}/tokens/{tokenId}`

#### Refresh a pipeline token

`PUT /pipelines/{pipelineId}/tokens/{tokenId}/refresh`

#### Delete a pipeline token

`DELETE /pipelines/{pipelineId}/tokens/{tokenId}`

#### Delete all pipeline tokens belong to this pipeline

`DELETE /pipelines/{pipelineId}/tokens`

#### Get latest build for a single job
`GET /pipelines/{id}/jobs/{jobName}/latestBuild`

Can search by build status
`GET /pipelines/{id}/jobs/{jobName}/latestBuild?status=SUCCESS`

#### Deletes cache for the given scope and cacheId for pipeline
`DELETE /pipelines/${id}/caches?scope={scope}&cacheId={id}`

Path Params:
* `id` - The id of the pipeline

Query Params:

* `scope` - Scope of the cache supporting values `pipelines|jobs|events`
* `cacheId` - The id of the cache - pipelineId/jobId/eventId

### Configuration - Reads the ecosystem
```
    ecosystem:
        store: 'https://store.screwdriver.cd'
        queue: 'https://queue.screwdriver.cd'
        cache:
            strategy: 's3'
```
Route requests to queue service api if strategy is **disk** and to store api if strategy is **s3**

#### Open pull request
`POST /pipelines/{id}/openPr`

### Access to Factory methods
The server supplies factories to plugins in the form of server settings:

```js
// handler pipelinePlugin.js
handler: async (request, h) => {
    const factory = request.server.app.pipelineFactory;

    // ...
}
```

#### Pipeline Templates
##### Get all pipeline templates

`GET /pipeline/templates`

Can use additional options for sorting, pagination and count:
`GET /pipeline/templates?sort=ascending&sortBy=name&page=1&count=50`

##### Get all versions for a pipeline template

`GET /pipeline/templates/{namespace}/{name}/versions`

Can use additional options for sorting, pagination and count:
`GET /pipeline/templates/{namespace}/{name}/versions?sort=ascending&page=1&count=50`

##### Create a pipeline template
Creating a template will store the template meta (`name`, `namespace`, `maintainer`, `latestVersion`, `trustedSinceVersion`, `pipelineId`) and template version (`description`, `version`, `config`, `createTime`, `templateId`)  into the datastore.

`version` will be auto-bumped. For example, if `mypipelinetemplate@1.0.0` already exists and the version passed in is `1.0.0`, the newly created template will be version `1.0.1`.


`POST /pipeline/template`
###### Arguments

'name', 'namespace', 'version', 'description', 'maintainer', 'config'

* `name` - Name of the template
* `namespace` - Namespace of the template
* `version` - Version of the template
* `description` - Description of the template
* `maintainer` - Maintainer of the template
* `config` - Config of the template. This field is an object that includes `steps`, `image`, and optional `secrets`, `environments`. Similar to what's inside the `pipeline`

Example payload:
```json
{
    "name": "example-template",
    "namespace": "my-namespace",
    "version": "1.3.1",
    "description": "An example template",
    "maintainer": "example@gmail.com",
    "config": {
        "steps": [{
            "echo": "echo hello"
        }]
    }
}
```

##### Validate a pipeline template
Validates a templates and returns a JSON containing the property ‘valid’ indicating if the template is valid or not

`POST /pipeline/template/validate`

###### Arguments

'name', 'namespace', 'version', 'description', 'maintainer', 'config'

* `name` - Name of the template
* `namespace` - Namespace of the template
* `version` - Version of the template
* `description` - Description of the template
* `maintainer` - Maintainer of the template
* `config` - Config of the template. This field is an object that includes `steps`, `image`, and optional `secrets`, `environments`. Similar to what's inside the `pipeline`

Example payload:
```json
{
    "name": "example-template",
    "namespace": "my-namespace",
    "version": "1.3.1",
    "description": "An example template",
    "maintainer": "example@gmail.com",
    "config": {
        "steps": [{
            "echo": "echo hello"
        }]
    }
}
```