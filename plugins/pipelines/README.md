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

Query Params:

* `page` - *Optional* Specific page of the set to return
* `count` - *Optional* Number of items per page
* `sort` - *Optional* Sort rangekey by `ascending` or `descending` (default `descending`)
* `sortBy` - *Optional* Field to sort by
* `type` - *Optional* Get pipeline or pr events (default `pipeline`)
* `prNum` - *Optional* Return only PR events of specified PR number
* `groupEventId` - *Optional* Return only events with a specified groupEventId
* `id` - *Optional* Fetch specific event ID; alternatively can use greater than(`gt:`) or less than(`lt:`) prefix
* `sha` - *Optional* Search `sha` and `configPipelineSha` for events
* `author` - *Optional* Search commit author `username` and `name` for events
* `creator` - *Optional* Search creator `username` and `name` for events
* `message` - *Optional* Search commit `message` for events

_Caveats_: Only one of the search fields can be used at one time (sha, author, creator, or message).

`GET /pipelines/{id}/events?page={pageNumber}&count={countNumber}&sort={sort}&type={type}&prNum={prNumber}&sha={sha}`

`GET /pipelines/{id}/events?message={message}`

`GET /pipelines/{id}/events?id=gt:{eventId}&count={countNumber}` (greater than eventId)

`GET /pipelines/{id}/events?id=lt:{eventId}&count={countNumber}&sort=ascending` (less than eventId)

#### Get all pipeline builds
`page`, `count`, `sort`, `latest`, `sortBy`, `fetchSteps`, `readOnly`, and `groupEventId` are optional
When `latest=true` and `groupEventId` is set, only latest builds in a pipeline based on groupEventId will be returned. The `latest` parameter must be used in conjunction with the `groupEventId`.

`GET /pipelines/{id}/builds?page={pageNumber}&count={countNumber}&sort={sort}&latest=true&groupEventId={groupEventId}&sortBy={sortBy}&fetchSteps=false&readOnly=false`

#### Get all jobs (including pull requests jobs)
`archived` is optional and has a default value of `false`, which makes the endpoint not return archived jobs (e.g. closed pull requests)

Arguments:

* `archived` - Optional and has a default value of `false`, which makes the endpoint not return archived jobs (e.g. closed pull requests)
* `type` - Optional and can be set to `pr` or `pipeline` to only return PR jobs or non-PR jobs
* `jobName` - Optional and can be set to only return only a single job

`GET /pipelines/{id}/jobs?archived={boolean}&type={type}&jobName={jobName}`

#### Get Pipeline Admin
`GET /pipelines/{id}/admin`

#### Get all triggers

`GET /pipelines/{id}/triggers`

#### Get all stages for a single pipeline

`page`, `count`, `sort`, `sortBy`, and `name` optional

`GET /pipelines/{id}/stages?page={pageNumber}&count={countNumber}&sort={sort}&name={stageName}`

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
Validate a pipeline template and return a JSON containing the boolean property ‘valid’ indicating if the template is valid or not

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

#### Get a pipeline template by namespace and name

`GET /pipeline/template/{namespace}/{name}`

##### Get a specific pipeline template by id

`GET /pipeline/template/{id}`

##### Get version of a pipeline template by name, namespace, version or tag

`GET /pipeline/template/{namespace}/{name}/{versionOrTag}`


#### Template Tag
Template tag allows fetching on template version by tag. For example, tag `mytemplate@1.1.0` as `stable`.

##### Get all tags for a pipeline template by name, namespace

`GET /pipeline/templates/{namespace}/{name}/tags`

Can use additional options for sorting, pagination and count:
`GET /pipeline/templates/{namespace}/{name}/tags?sort=ascending&sortBy=name&page=1&count=50`

##### Create/Update a tag

If the template tag already exists, it will update the tag with the new version. If the template tag doesn't exist yet, this endpoint will create the tag.

*Note: This endpoint is only accessible in `build` scope and the permission is tied to the pipeline that creates the template.*

`PUT /templates/{templateName}/tags/{tagName}` with the following payload

* `version` - Exact version of the template (ex: `1.1.0`)

##### Delete a pipeline template
Deleting a pipeline template will delete a template and all of its associated tags and versions.

`DELETE /pipeline/templates/{namespace}/{name}`

###### Arguments

* `name` - Name of the template

##### Delete a pipeline template version

Delete the template version and all of its associated tags.
If the deleted version was the latest version, the API would set the `latestVersion` attribute of the templateMeta to the previous version.

`DELETE /pipeline/templates/{namespace}/{name}/versions/{version}`

###### Arguments

'namespace', 'name', 'version'

* `namespace` - Namespace of the template
* `name` - Name of the template
* `version` - Version of the template


##### Delete a pipeline template tag

Delete the template tag. This does not delete the template itself.

*Note: This endpoint is only accessible in `build` scope and the permission is tied to the pipeline that creates the template.*

`DELETE /pipeline/templates/{namespace}/{name}/tags/{tag}`

###### Arguments

'namespace', 'name', 'tag'

* `namespace` - Namespace of the template
* `name` - Name of the template
* `tag` - Tag name of the template

##### Update a pipeline template's trusted property

Update a pipeline template's trusted property

`PUT /pipeline/templates/{namespace}/{name}/trusted`

###### Arguments

'namespace', 'name'

* `namespace` - Namespace of the template
* `name` - Name of the template

Example payload:
```json
{
    "trusted": true
}
```
