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
