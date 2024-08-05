# Overview
Pipeline template abstracts entire pipeline configuration into reusable modules which can be imported (screwdriver.yaml) and extended to build individual pipelines.

Github: https://github.com/screwdriver-cd/screwdriver/issues/2135

## Table of Contents

- [Requirements](#requirements)
- [Design](#design)
    - [Template Management](#template-management)
        - [Template Configuration Schema](#template-configuration-schema)
        - [API](#api)
            - [DB Model](#db-model)
            - [Domain Model](#domain-model)
            - [Config Parser](#config-parser)
            - [Template Validator](#template-validator)
            - [Data Access Object/Layer (DAO)](#data-access-objectlayer-dao)
            - [Endpoints](#endpoints)
            - [SD CLI](#sd-cli)
        - [UI](#ui)
    - [Template Usage](#template-usage-1)
        - [Pipeline configuration](#pipeline-configuration)
        - [API](#api-1)
            - [DB Model](#db-model-1)
            - [Domain Model](#domain-model-1)
            - [Config Parser](#config-parser-1)
        - [UI](#ui-1)

# Requirements
## Template Management
1. Ability to validate a pipeline template configuration
1. Ability to create/store versioned pipeline template configuration from the screwdriver pipeline which owns the template
1. Ability to create/update tags referring to a version of the template from a screwdriver pipeline which owns the template
1. A Screwdriver admin should be able to mark a pipeline template as trusted or not
   a. Capture the version since it was marked as trusted
   b. Clear the version, when a template is no longer marked as trusted which was previously trusted
1. All users should be able to view all the pipeline templates available in the system
1. All users should be able to view all the versions of a pipeline template
1. All Users should be able to view the configuration a specific version of a pipeline template
1. Below users should be allowed to delete a specific version and all of its associated tags
   a. Screwdriver admin
   b. Screwdriver pipeline owning the template
   c. Admins of the SCM repo hosting the template configuration
1. Below users should be allowed to delete a template and all of its associated versions and tags
   a. Screwdriver admin
   b. Screwdriver pipeline owning the template
   c. Admins of the SCM repo hosting the template configuration

## Template Usage
To be updated


# Design
## Template Management

![Screenshot 2023-08-14 at 9 58 41 PM](https://github.com/screwdriver-cd/screwdriver/assets/67897071/8bff2e37-8b2b-415e-866a-24f12894de72)

### Template Configuration Schema

![Screenshot 2023-08-14 at 9 59 33 PM](https://github.com/screwdriver-cd/screwdriver/assets/67897071/9e9fdb9d-7acc-4031-aec2-3fc6a9782ebf)



__Basic Configuration:__

```yaml
namespace: myNamespace
name: template_name
version: '1.3.2'
description: template for testing
maintainer: foo@bar.com

config:
    jobs:
        main:
            image:
            steps:
```


__Advanced Configuration:__

```yaml
namespace: myNamespace
name: template_name
version: '1.3.2'
description: template for testing
maintainer: foo@bar.com
config:
    shared:
        image: 
        environment:
            SD_SONAR_OPTS:
        steps:
        annotations:
 
    parameters:
        FOO: bar

    jobs:
        main: 
            requires:
            image:
            template:
            steps:
            parameters:
            secrets:
            settings:
                email:
                slack:
            annotations:                
            sourcePaths:
        test:
            ....

```

| Field   | Sub Field |  Schema |  Description  |
| ---------- | ------------- |------------- |------------- |
| namespace |  |  Same as Job template `namespace` [schema][schema-namespace]  | Required |
| name |  |  Same as Job template `name` [schema][schema-name]  | Required |
| maintainer |  |  Same as Job template `maintainer` [schema][schema-maintainer]  | Required |
| version |  |  Same as Job template `version` [schema][schema-version]  | Required |
| description |  |  Same as Job template `description` [schema][schema-description]  | Required |
| config | shared |  Same as Pipeline `shared` [schema][schema-shared]  | Optional |
|  | jobs |  Same as Pipeline `jobs` [schema][schema-jobs]  | Required |
|  | parameters |  Same as Pipeline `parameters` [schema][schema-params]  | Optional |


## API

### DB Model

**Pipeline Template**

Approach 1 - Add Pipeline template data to existing template table:

- Add new column `templateType` that takes 2 values -> `PIPELINE` and `JOB`
- `images` column should have NULL when `templateType` = `PIPELINE`


Approach 2 - Create new tables

Add two new tables to persist pipeline template
- templateMeta
    - metadata about pipeline template: `name`, `namespace`, `maintainer`, etc.
- pipelineTemplateVersions
    - configuration associated with individual versions



***templateMeta***

| Column   | Type |  Nullable |  Description  |
| ---------- | ------------- |------------- |------------- |
| id | Sequelize.INTEGER.UNSIGNED |  No  |  |
| pipelineId | Sequelize.DOUBLE |  No  | Identifier of the Screwdriver pipeline which owns the template |
| namespace | Sequelize.STRING(64) |  No  |  |
| name | Sequelize.STRING(64) |  No  |  |
| maintainer | Sequelize.STRING(64) |  No  |  |
| trustedSinceVersion | Sequelize.STRING(32) |  Yes  |  |
| latestVersion | Sequelize.STRING(16) |  Yes  |  |
| createTime | Sequelize.STRING(32) |  No  |  |
| updateTime | Sequelize.STRING(32) |  No  |  |
| templateType | Sequelize.STRING(16) |  No  | Allowed values: ‘JOB’, ‘PIPELINE’ |

_Constraints_

- Add composite unique constraint on name, namespace, and templateType

_Indexes_

- Add index on name
- Add index on namespace

***pipelineTemplateVersions***

| Column   | Type |  Nullable |  Description  |
| ---------- | ------------- |------------- |------------- |
| id | Sequelize.INTEGER.UNSIGNED |  No  |  |
| templateId | Sequelize.DOUBLE |  No  | Identifier of the Screwdriver pipeline which owns the template |
| description | Sequelize.STRING(64) |  No  |  |
| version | Sequelize.STRING(64) |  No  |  |
| config | Sequelize.STRING(64) |  No  |  |
| createTime | Sequelize.STRING(32) |  Yes  |  |

_Constraints_

- Composite unique constraint on templateId and version

_Indexes_

- Add index on templateId
- Add index on version


**Conclusion**

Proceeding with approach #2
- Normalizes the data to reduce redundancy




**Pipeline Template Tags**

We can reuse the existing `templateTags` table to store the tags associated with pipeline templates by adding a new column `templateType`

***Existing Columns***
| Column   | Type |  Nullable |  Description  |
| ---------- | ------------- |------------- |------------- |
| id | Sequelize.INTEGER.UNSIGNED |  No  |  |
| createTime | Sequelize.STRING(32) |  No  | Created during API call |
| namespace | Sequelize.STRING(64) |  No  |  |
| name | Sequelize.STRING(64)|  No  |  |
| tag | Sequelize.STRING(30) |  No  |  |
| version | Sequelize.STRING(16) |  No  |  |

***New Columns***
| Column   | Type |  Nullable |  Description  |
| ---------- | ------------- |------------- |------------- |
| templateType | Sequelize.STRING(16) |  No  | Allowed values: ‘JOB’, ‘PIPELINE’ & Default value: ‘JOB’ |


_Constraints_
- Drop unique constraint on `name`, `namespace` and `tag` columns
- Add unique constraint on `name`, `namespace`, ‘type’ and `tag` columns




### Domain Model

**PipelineTemplate**

| Field   | Sub Field |  Schema |  Description  |
| ---------- | ------------- |------------- |------------- |
| id |  |  Same as Job template `id` [schema][schema-domain-id]  |  |
| name |  |  Same as this [schema][schema-domain-name]  |  |
| namespace |  |  Same as this [schema][schema-domain-namespace]  |  |
| maintainer |  |  Same as this [schema][schema-domain-maintainer]  |  |
| trustedSinceVersion |  |  Same as this [schema][schema-domain-trustedSinceVersion]  |  |
| latestVersion |  |  Same as this [schema][schema-domain-latestVersion]  |  |
| pipelineId |  |  Same as this [schema][schema-domain-pipelineId]  |  |

**PipelineTemplateVersion**

| Field   | Sub Field |  Schema |  Description  |
| ---------- | ------------- |------------- |------------- |
| id |  |  Same as Job template `id` [schema][schema-domain-id]  |  |
| description |  |  Same as this [schema][schema-domain-description]  |  |
| version |  |  Same as this [schema][schema-domain-version]  |  |
| config | shared |  Same as this [schema][schema-domain-shared]  |  |
|  | jobs |  Same as this [schema][schema-domain-jobs]  | Required |
|  | parameters |  Same as this [schema][schema-domain-params]  |  |
| createTime |  |  Same as this [schema][schema-domain-createTime]  |  |
| templateId |  |  Same as this [schema][schema-domain-id]  |  |


### Config Parser

No change needed

### Template Validator

Add a new function that takes the parsed template (Javascript) object as input and validates it against the [schema][schema-template-validator].

### Data Access Object/Layer (DAO)

Provides an interface to integrate with the database.

***TemplateMeta***

The `TemplateMeta` module will extend the `BaseModel` class to expose methods to update or delete pipeline/job templates. For pipeline templates:

_remove(templateVersionFactory, templateTagFactory)_
- Deletes template metadata by removing the entry from `templateMeta` table
- Get the configurations associated with all the versions of this template using templateVersionFactory
- Call remove(templateTagFactory) on each version from step #2

_update()_
Default implementation


***TemplateMetaFactory***

The `TemplateMetaFactory` module will extend the `BaseFactory` class to expose methods to create or fetch pipeline templates.

_list(config)_

Fetch and return entries from `templateMeta` table for the criteria specified in the config.

Arguments:
| Argument   | Description  |
| ---------- | ------------- |
| config.params.id | Identifier of the template |
| config.params.name | |
| config.params.namespace |  |


_get(config)_

Fetch and return the template configuration from `PipelineTemplate` matching the criteria specified in the config

Arguments:
| Argument   | Description  |
| ---------- | ------------- |
| config.params.id | |
| config.params.name | |
| config.params.namespace |  |



_create(config)_

Calls getTemplateType() method to update `templateType` field in templateMeta table

Arguments:
| Argument   | Description  |
| ---------- | ------------- |
| config.<?> |`?` refers to the fields mentioned in template configuration schema |
| config.pipelineId | Identifier of the Screwdriver pipeline that is publishing the template |



***PipelineTemplate***

The `PipelineTemplate` module will extend the `TemplateMeta` class.

***PipelineTemplateFactory***

The `PipelineTemplateFactory` module will extend the `TemplateMetaFactory` class to expose methods to create or fetch pipeline templates.

_getTemplateType()_
Return the type of template as ‘PIPELINE’


***PipelineTemplateVersion***

The `PipelineTemplateVersion` module will extend the `BaseModel` class to expose methods to update or delete pipeline template versions.

_remove(templateTagFactory)_
- Removes the entry from `pipelineTemplateVersions` table
- Get all the associated tags using templateTagFactory.list(config)
- Call remove() on each tag from step #2

_update()_
Default implementation


***PipelineTemplateVersionFactory***

The `PipelineTemplateVersionFactory` module will extend the `BaseFactory` class to expose  methods to create or fetch template versions.

_create(config)_
1. If template does not exist in `templateMeta`,
    - adds a new entry in  `templateMeta` table to persist metadata associated with the template
    - Adds an entry in `pipelineTemplateVersions` table to persist version and configuration for the new template by calling templateVersionFactory.create()

1. If template exists in `templateMeta`,
    - adds entry in `pipelineTemplateVersions` table with latest details to persist version and configuration for the new template by calling templateVersionFactory.create()

Arguments:
| Argument   | Description  |
| ---------- | ------------- |
| config.<?> |`?` refers to the fields of PipelineTemplateVersion |


_list(config)_

Fetch and return entries from `pipelineTemplateVersions` table for the criteria specified in the config.

Arguments:
| Argument   | Description  |
| ---------- | ------------- |
| config.params.templateId| |
| config.params.name | |
| config.params.namespace | |


_get(config)_

Fetch and return the template configuration from `pipelineTemplateVersions` matching the criteria specified in the config

Arguments:
| Argument   | Description  |
| ---------- | ------------- |
| config.params.templateId | Filter result by templateId. Template name and templateId are mutually exclusive |
| config.params.name | |
| config.params.namespace | |
| config.params.version | |


_getWithMetadata(config)_

Fetch and return the template configuration from `pipelineTemplateVersions` matching the criteria specified in the config and also include the corresponding metadata from the `templateMeta` table

Arguments:
| Argument   | Description  |
| ---------- | ------------- |
| config.params.templateId | Filter result by templateId |
| config.params.name | |
| config.params.namespace | |
| config.params.version | |


***TemplateTagFactory***

As we are utilizing the current templateTags table and introducing a new column called `templateType`, we will modify the existing templateTagsFactory module to incorporate the `templateType` field.

_listPipelineTemplateTags(config)_

This will add `templateType`: ‘PIPELINE’ to `config.params`


Arguments:
| Argument   | Description  |
| ---------- | ------------- |
| config.templateName | |
| config.templateNamespace | |
| config.params.version | |

Will set  `config.params.templateType` = 'PIPELINE’

_createPipelineTag(config)_

This will add `templateType: ‘PIPELINE’` to `config` and then call `create(config)`


Arguments:
| Argument   | Description  |
| ---------- | ------------- |
| config.templateName | |
| config.templateNamespace | |
| config.params.version | |

Will set  `config.params.templateType` = 'PIPELINE’


***PipelineTemplateTagFactory***
The PipelineTemplateTagFactory module will extend the TemplateTagFactory class to expose  methods to get template types.

_getTemplateType()_
Return `templateType` as ‘PIPELINE’

***JobTemplateTagFactory***
The JobTemplateTagFactory module will extend the TemplateTagFactory class to expose  methods to get template types.

_getTemplateType()_
Return `templateType` as ‘JOB’



### Endpoints

***1. Validate a template***

This endpoint parses the template yaml file and confirms its validity so that it can be used for publishing with no errors.

**Request:**

- **Method**: POST
- **Path** : ‘/pipeline/template/validate’
- **Payload:**

  ```
{
"namespace": "myNamespace",
"name": "template_name",
"version": "1.3",
"description": "template for testing",
"maintainer": "foo@bar.com",
"config": {
"jobs": {
"main": {
"image": "node:18",
"steps": "abc",
"requires": "xyz"
}
}
}}
```

**Response:**

JSON containing the property ‘valid’ indicating if the template is valid or not.

  ```
{
"valid": "true"
}
```


***2. Validate and Publish a template***

This endpoint accepts template configuration as input, validates it  and publishes it so that it can be used to create pipelines.

**Request:**

- **Method**: POST
- **Path** : ‘validator/pipelineTemplate’
- **Payload:**

  ```
{
"namespace": "myNamespace",
"name": "template_name",
"version": "1.3",
"description": "template for testing",
"maintainer": "foo@bar.com",
"config": {
"jobs": {
"main": {
"image": "node:18",
"steps": "abc",
"requires": "xyz"
}
}
}}
```

**Response:**

JSON object representing the template version along with the metadata which was created by the API.

  ```
{
"id": 3,
"templateId": 123,
"pipelineId": 3,
"namespace": "myNamespace",
"name": "template_name",
"version": "1.3.2",
"description": "template for testing",
"maintainer": "foo@bar.com",
"config": {
"jobs": {
"main": {
"image": "node:18",
"steps": "abc",
"requires": "xyz"
}
}
},
"createTime": "2023-06-12T21:52:22.706Z"
}
```


***3. Create/Update template tag***

This endpoint accepts the version as input and creates/updates a tag for the template name and namespace specified in the endpoint path.

**Request:**

- **Method**: PUT
- **Path** : ‘/pipeline/template/{templateNamespace}/{templateName}/tags/{tagName}’
- **Payload:**

  ```
{

"version": "1.3.2"
}
```

**Response:**

JSON object representing the template tag details and status code.

  ```
{
"id": 2,
"createTime": "2023-06-12T21:52:22.706Z"
"namespace": "tempNameSpace"
"name": "templateName",
"tag": "tagName",
"version": "1.3.2",
}
```


***4. List all the templates***

Returns an array template meta for all the pipeline templates

**Request:**

- **Method**: GET
- **Path** :  ‘/pipeline/templates’

**Response:**

JSON object consisting of a list of objects having template metadata for each template.

  ```
Status Code: 200 (OK)
Response Body:
[
{
"id": 123,
"pipelineId": 3,
"name": "example-template",
"namespace": "my-namespace",
"description": "An example template",
"maintainer": "example123@gmail.com",
“trustedSinceVersion”: “true”,
“latestVersion”: “1.3.2”,
"createTime": "2023-06-12T21:52:22.706Z",
"updateTime": "2023-06-29T11:23:45.706Z"
},
{
…
},
…
]
```

***5. Get a specific template by id***

Returns an array of details for a specific template when its id is provided in the endpoint.

**Request:**

- **Method**: GET
- **Path** :   ‘/pipeline/template/{templateId}`

**Response:**

JSON object consisting template details for the given Id.

  ```
Status Code: 200 (OK)
Response Body:
{
"id": 123,
"pipelineId": 3,
"namespace": "my-namespace",
"name": "example-template",
"description": "An example template",
"maintainer": "example@gmail.com",
“trustedSinceVersion”: “1.2.3”,
"latestVersion": "1.3.2",
"createTime": "2023-06-12T21:52:22.706Z",
"updateTime": "2023-06-29T11:23:45.706Z"

}
```

***6. Get a specific template by namespace and name***

Returns template meta for the specified namespace and name

**Request:**

- **Method**: GET
- **Path** :   ‘/pipeline/templates/{templateNamespace}/{templateName}`

**Response:**

JSON object consisting template details for the given template namespace and name combination.

  ```
Status Code: 200 (OK)
Response Body:
{
"id": 123,
"pipelineId": 3,
"namespace": "my-namespace",
"name": "example-template",
"description": "An example template",
"maintainer": "example@gmail.com",
“trustedSinceVersion”: “1.2.3”,
"latestVersion": "1.3.2",
"createTime": "2023-06-12T21:52:22.706Z",
"updateTime": "2023-06-29T11:23:45.706Z"

}
```

***7. List all the versions for a template namespace and name***

Returns fields from the pipelineTemplateVersions table for the specified namespace and name.

**Request:**

- **Method**: GET
- **Path** :    ‘/pipeline/templates/{templateNamespace}/{templateName}/versions`

**Response:**

JSON object consisting list of template records, representing all versions of the specified template name.

  ```
Status Code: 200 (OK)
Response Body:
[
{
"id": 1,
"templateId": 123,
"description": "An example template",
"version": "1.0.0",
"config": {
"jobs": {
"main": {
"image": "node:18",
"steps": {
"printLine": "echo 'Testing template creation V1'"
},
"requires": "[~pr, ~commit]"
}
}
},
"createTime": "2023-06-12T21:52:22.706Z"
},
{
"id": 2,
"templateId": 123,
"description": "An example template",
"version": "1.1.0",
"config": {
"jobs": {
"main": {
"image": "node:18",
"steps": {
"printLine": "echo 'Testing template creation V1.1'"
},
"requires": "[~pr, ~commit]"
}
}
},
"createTime": "2023-06-12T21:52:22.706Z"  }
]
```

***8. List all the tags for a template namespace and name***

Returns fields from pipeline template tag table for specified namespace and name.


**Request:**

- **Method**: GET
- **Path** :    ‘/pipeline/templates/{templateNamespace}/{templateName}/tags`

**Response:**

JSON object consisting list of template tags, representing all the tags associated with the specified template name and namespace.

  ```
Status Code: 200 (OK)
Response Body:
[
{
"id": 1,
"createTime": "2023-06-12T22:52:22.706Z",   
"namespace": "namespace123",
"name": "testTemplate",
"tag": "stable",
"version": "1.0.0"
},
{
"id": 2,
"createTime": "2023-06-12T24:45:22.706Z",   
"namespace": "namespace123",
"name": "testTemplate",
"tag": "latest"
"version": "1.1.0"
}
]
```

***9. Get a specific template version details by version number or tag***

Returns fields from both template meta and version table associated with the specified pipeline template namespace, name and version/tag


**Request:**

- **Method**: GET
- **Path** :    ‘/pipeline/templates/{templateNamespace}/{templateName}/{versionOrTag}’

**Response:**

JSON object consisting of the template details for the given version number or tag.

  ```
Status Code: 200 (OK)
Response Body:
[
{
"id":1",
"templateId": 123,
"pipelineId": 3,
"namespace": "myNamespace",
"name": "template_name",
"version": "1.3.2",
"description": "template for testing",
"maintainer": "example@gmail.com",
"config": {
"jobs": {
"main": {
"image": "node:18",
"steps": {
"printLine": "echo 'Testing template creation V1'"
},
"requires": "[~pr, ~commit]"
}
}
},
"createTime": "2023-06-12T21:52:22.706Z"
}
]
```

***10. Remove template and associated versions and tags***

Deletes the template and its corresponding versions and tags


**Request:**

- **Method**: DELETE
- **Path** :    ‘/pipeline/templates/{templateNamespace}/{templateName}`

**Response:**

HTTP status code 204 (No Content)


***11. Remove template tag***

Deletes the template tag for a specific template from the `templateTags` table where `templateType` is ‘PIPELINE’


**Request:**

- **Method**: DELETE
- **Path** :    ‘/pipeline/templates/{templateNamespace}/{templateName}/tags/{tagName}’

**Response:**

HTTP status code 204 (No Content)

***12. Remove template version and associated tags***

Deletes the specific template tag and then removes the associated versions

**Request:**

- **Method**: DELETE
- **Path** :    ‘/pipeline/templates/{templateNamespace}/{templateName}/versions/{version}`

**Response:**

HTTP status code 204 (No Content)


### SD CLI

We will introduce new commands to validate, publish and tag pipeline templates because using the existing commands will not allow us to easily differentiate between the two types of templates (job template and pipeline template)

CLI can be installed using below command:

``` $ npm install sd-template-main ```


***1. Validate***

We will add a new command `pipeline-template-validate`.


The default path to the template.yaml file is `./sd-template.yaml` unless specified in the environment variable `SD_TEMPLATE_PATH`

This command will
- read the content of ‘template.yaml’ and parse it into Javascript object
- make a POST request ‘/pipeline/template/validate’ endpoint

Note: This command does accept any arguments

Usage:

```$ ./node_modules/.bin/pipeline-template-validate --json```


***2. Publish***

We will add a new command `pipeline-template-publish`.

This command will
- Read the content of `template.yaml` and parse it into Javascript object
- Make a POST request to `/pipelineTemplates` endpoint to create a new template
- Make a PUT request to `/pipeline/template/{templateName}/tags/{tagName}` endpoint to create/update the tag for the newly created template

The default path to the template.yaml file is `./sd-template.yaml` unless specified in the environment variable `SD_TEMPLATE_PATH`


Arguments:
| Argument   | Optional  | Description |
| ---------- | ------------- | ------------- |
| tag| Yes | Specifies the name of the tag to be created/updated after the template is created. Uses `latest` as the tag name if not specified.


Usage:

```
$ ./node_modules/.bin/pipeline-template-publish --json

#takes custom tag name "stable"
$ ./node_modules/.bin/pipeline-template-publish --json --tag stable
 ```


***3. Create/Update Tag***

We will add a new command `pipeline-template-tag`.

This command will
- Take template details (`name`, `namespace` and `version`) and name of the tag as input
- Make a PUT request to ‘/pipeline/template/{templateName}/tags/{tagName}’ endpoint to create or update the tag to the specified template



Arguments:
| Argument   | Description  |
| ---------- | ------------- |
| namespace| Specifies template namespace |
| name| Specifies template name |
| version| Specifies version of the template |
| tag| Specifies tag name |


Usage:

```
$ ./node_modules/.bin/pipeline-template-tag --json --namespace template123 –name 123 --version 4.0.0 --tag stable
 ```

***4. Remove a Template***

We will add a new command `pipeline-template-remove`.

This command will
- Remove a template and associated versions and tags by making a DELETE request to the ‘/pipeline/templates/{templateName}’ API endpoint



Arguments:
| Argument   | Description  |
| ---------- | ------------- |
| namespace| Specifies template namespace |
| name| Specifies template name |


Usage:

```
$ ./node_modules/.bin/pipeline-template-remove --json --namespace template123 –name 123
 ```



***5. Remove a Template Tag***

We will add a new command `pipeline-template-remove-tag`.

This command will
- Take template details (`name` and `namespace`) and name of the tag as input
- Make a DELETE request ‘/pipeline/templates/{templateName}/tags/{tagName}’ endpoint to remove the tag for the specified template




Arguments:
| Argument   | Description  |
| ---------- | ------------- |
| namespace| Specifies template namespace |
| name| Specifies template name |
| tag| Specifies tag name |


Usage:

```
$ ./node_modules/.bin/pipeline-template-remove-tag --json --namespace template123 –name 123 --tag stable
```

***6. Remove a Template Version***

We will add a new command `pipeline-template-remove-version`.

This command will
- Take template name, namespace and version as input
- Make a DELETE request ‘/pipeline/templates/{templateName}versions/{version}’ endpoint to delete the config and tags associated with the specified version


Arguments:
| Argument   | Description  |
| ---------- | ------------- |
| namespace| Specifies template namespace |
| name| Specifies template name |
| version| Specifies the template version to be removed |


Usage:

```
$ ./node_modules/.bin/pipeline-template-remove-version --namespace template123 –name 123 --version 1.0.0
```


***7. Get a Template Config with metadata by Tag***

We will add a new command `pipeline-template-get`.

This command will
- Take template details (`name` and `namespace`) and tag name as input
- Make a GET request to ‘/pipeline/templates/{templateName}/{versionOrTag}’ endpoint to get template configuration along with its metadata associated with the specified tag



Arguments:
| Argument   | Description  |
| ---------- | ------------- |
| namespace| Specifies template namespace |
| name| Specifies template name |
| tag| Specifies the template tag name |


Usage:

```
$ ./node_modules/.bin/pipeline-template-get --namespace template123 –name 123 --tag latest
```

## UI

TODO: Will be updated after the meeting with the UX designer.




## Template Usage

### Pipeline configuration

__Basic Configuration (without customization):__

```yaml
template: foo/bar@latest
```

__Advanced Configuration (with customization):__

```yaml
template: foo/bar@latest
shared:
    environment:
       SD_SONAR_OPTS:
    settings:
       email: [foo@bar.com]
```
New fields:

| Field   | Sub Field  | Schema |Description |
| ---------- | ------------- | ------------- | ------------- |
| template|  |Same as job `template` [schema][schema-uasage-template]| Optional. Mutually exclusive with existing fields `jobs` and `parameters` |


Existing fields:

| Field   | Sub Field  | Schema |Description |
| ---------- | ------------- | ------------- | ------------- |
| shared| settings, environment |Refer to job [schema][schema-uasage-shared]| Optional. Allowed even when pipeline is using a template |
| | annotations, blockedBy, cache, description, freezeWindows, image, matrix, order, parameters, provider, requires, secrets, sourcePaths, steps, template, templateId| | Not allowed when pipeline is using a template. Note: Customization of these fields would be supported in future phases|


## API

### DB Model

**Pipeline**
- Add a new column `templateVersionId` in ‘pipeline’ table


| Column   | Type  | Nullable |Description |
| ---------- | ------------- | ------------- | ------------- |
| templateVersionId | Sequelize.DOUBLE |Yes| Identifier of ‘pipelineTemplateVersions’ table |


### Domain Model

**Pipeline**
- Add a new field `templateVersionId`


| Column   | Type  | Nullable |Description |
| ---------- | ------------- | ------------- | ------------- |
| templateVersionId | Joi.number().integer().positive() |Yes| Identifier of ‘pipelineTemplateVersions’ table |


### Config Parser

![Screenshot 2023-08-15 at 11 13 51 AM](https://github.com/screwdriver-cd/screwdriver/assets/67897071/20a29ce7-b19b-4cf0-8a84-7ddfeb71b81d)

When pipeline configuration contains `template` we need to perform below steps before flattening the configuration to build domain objects (pipeline, jobs, etc)
1. Validate the configuration

   a. `jobs` and `parameters` should not be allowed

   b. `shared` can contain only `settings` and `environment`

1. Get template configuration (`shared`, `jobs`, `parameters`) from DB
1. Merge `shared` from pipeline configuration into template configuration

This merged configuration will then be flattened (merging `shared` into job configuration, etc) as it is done currently.

Also, reference to the template will be set in the `pipeline` domain object.


## UI

TODO: Will be updated after the meeting with the UX designer.































[schema-namespace]: https://github.com/screwdriver-cd/data-schema/blob/master/config/template.js#L7
[schema-name]: https://github.com/screwdriver-cd/data-schema/blob/master/config/template.js#LL15C1-L15C41
[schema-maintainer]: https://github.com/screwdriver-cd/data-schema/blob/master/config/template.js#LL47C1-L47C41
[schema-version]: hhttps://github.com/screwdriver-cd/data-schema/blob/master/config/template.js#L30
[schema-description]: https://github.com/screwdriver-cd/data-schema/blob/master/config/template.js#L42
[schema-shared]: https://github.com/screwdriver-cd/data-schema/blob/master/config/base.js#LL31C1-L31C1
[schema-jobs]: https://github.com/screwdriver-cd/data-schema/blob/master/config/base.js#L26
[schema-params]: https://github.com/screwdriver-cd/data-schema/blob/master/config/parameters.js#L13
[schema-domain-id]: https://github.com/screwdriver-cd/data-schema/blob/master/models/template.js#L9
[schema-domain-name]: https://github.com/screwdriver-cd/data-schema/blob/master/models/template.js#L12
[schema-domain-namespace]: https://github.com/screwdriver-cd/data-schema/blob/master/models/template.js#L17
[schema-domain-maintainer]: https://github.com/screwdriver-cd/data-schema/blob/master/models/template.js#L15
[schema-domain-trustedSinceVersion]: https://github.com/screwdriver-cd/data-schema/blob/master/config/template.js#L36
[schema-domain-latestVersion]: https://github.com/screwdriver-cd/data-schema/blob/master/config/template.js#L36
[schema-domain-pipelineId]: https://github.com/screwdriver-cd/data-schema/blob/master/models/pipeline.js#L30C7-L30C7
[schema-domain-description]: https://github.com/screwdriver-cd/data-schema/blob/master/models/template.js#L14
[schema-domain-version]: https://github.com/screwdriver-cd/data-schema/blob/master/models/template.js#L13
[schema-domain-shared]: https://github.com/screwdriver-cd/data-schema/blob/master/config/base.js#LL31C1-L31C1
[schema-domain-jobs]: https://github.com/screwdriver-cd/data-schema/blob/master/config/base.js#L67
[schema-domain-params]: https://github.com/screwdriver-cd/data-schema/blob/master/config/parameters.js#L6
[schema-domain-createTime]: https://github.com/screwdriver-cd/data-schema/blob/master/models/template.js#L19
[schema-template-validator]: https://docs.google.com/document/d/12MAT6XxHQ28vqkPw6xlcxtVR3M5tOgnYGHEfUPyAWPI/edit#heading=h.47lbrhrjbdr6
[schema-uasage-template]: https://github.com/screwdriver-cd/data-schema/blob/master/config/job.js#L129
[schema-uasage-shared]: https://github.com/screwdriver-cd/data-schema/blob/master/config/job.js#L161

