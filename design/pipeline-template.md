# Pipeline Template Design

## Table of Contents

-   [Pipeline Template Usage](#pipeline-template-usage)

    -   [Current Supported Customization](#current-supported-customization)
    -   [Customization in Phase-2](#customization-in-phase-2)
        -   [Diagram Illustration](#diagram-illustration)
        -   [List of Customizable Configurations](#list-of-customizable-configurations)

-   [Flatten template config to eliminate shared config during parser](#flatten-template-config-to-eliminate-shared-config-during-parser)
-   [Customizing Configuration at the Pipeline Level](#customizing-configuration-at-the-pipeline-level)
    -   [Cache](#cache)
    -   [Subscribe](#subscribe)
    -   [Parameters](#parameters)
    -   [Annotations](#annotations)
    -   [Stages](#stages)
    -   [Shared](#shared)
    -   [Jobs](#jobs)
-   [Customizing jobs](#customizing-jobs)

    -   [Use Case 1: Adding a new job which is not part of the Pipeline Template](#use-case-1-adding-a-new-job-which-is-not-part-of-the-pipeline-template)
    -   [Use Case 2: Modifying a job that does not use a (job) template](#use-case-2-modifying-a-job-that-does-not-use-a-job-template)
    -   [Use Case 3: Modifying a job that uses a (job) template](#use-case-3-modifying-a-job-that-uses-a-job-template)

-   [Customizing shared configuration](#customizing-shared-configuration)

-   [Nested Pipeline Template](#nested-pipeline-template)

-   [Trusted Template](#trusted-template)

-   [Pipeline Template Usage Metrics](#pipeline-template-usage-metrics)

## Pipeline Template Usage

### Current Supported Customization

<table>
<colgroup>
<col style="width: 25%" />
<col style="width: 21%" />
<col style="width: 28%" />
<col style="width: 25%" />
</colgroup>
<thead>
<tr class="header">
<th>Field</th>
<th>Sub Field</th>
<th>Schema</th>
<th>Description</th>
</tr>
<tr class="odd">
<th rowspan="2">shared</th>
<th><p>settings<br />
environment</p>
<p>image</p></th>
<th rowspan="2">Refer to Job <a
href="https://github.com/screwdriver-cd/data-schema/blob/master/config/job.js#L161"><u>schema</u></a></th>
<th><p>Optional.</p>
<p>Allowed even when the pipeline is using a template</p></th>
</tr>
<tr class="header">
<th><p>annotations</p>
<p>blockedBy</p>
<p>cache</p>
<p>description</p>
<p>freezeWindows</p>
<p>image</p>
<p>matrix</p>
<p>order</p>
<p>parameters</p>
<p>provider</p>
<p>requires</p>
<p>secrets</p>
<p>sourcePaths</p>
<p>steps</p>
<p>template</p>
<p>templateId</p></th>
<th><p>Not allowed when the pipeline is using a template</p>
<p><strong>Note: Customization of these fields will be supported in
future phases.</strong></p></th>
</tr>
<tr class="odd">
<th><p>jobs</p>
<p>annotations</p>
<p>parameters</p>
<p>cache<br />
childPipelines</p>
<p>stages</p>
<p>subscribe</p></th>
<th></th>
<th></th>
<th><p>Not allowed when the pipeline is using a template</p>
<p><strong>Note: Customization of these fields will be supported in
future phases.</strong></p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

### Customization in Phase-2

#### Diagram Illustration

#### List of Customizable Configurations

<table>
<colgroup>
<col style="width: 25%" />
<col style="width: 21%" />
<col style="width: 28%" />
<col style="width: 25%" />
</colgroup>
<thead>
<tr class="header">
<th>Field</th>
<th>Sub Field</th>
<th>Schema</th>
<th>Description</th>
</tr>
<tr class="odd">
<th rowspan="3">shared</th>
<th><p>settings<br />
environment</p>
<p>image</p>
<p>secrets</p></th>
<th rowspan="3">Refer to Job <a
href="https://github.com/screwdriver-cd/data-schema/blob/master/config/job.js#L161"><u>schema</u></a></th>
<th rowspan="3"></th>
</tr>
<tr class="header">
<th><p>annotations</p>
<p>blockedBy</p>
<p>cache</p>
<p>description</p>
<p>freezeWindows</p>
<p>image</p>
<p>matrix</p>
<p>order</p>
<p>parameters</p>
<p>provider</p>
<p>requires</p>
<p>sourcePaths</p>
<p>template</p>
<p>templateId</p></th>
</tr>
<tr class="odd">
<th>steps</th>
</tr>
<tr class="header">
<th><p>jobs</p>
<p>annotations</p>
<p>parameters</p>
<p>cache<br />
childPipelines</p>
<p>stages</p>
<p>subscribe</p></th>
<th></th>
<th></th>
<th></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## Flatten template config to eliminate shared config during parser

<span class="mark">  
In a pipeline template, the configuration shared among multiple tasks
should not be stored separately. Instead, it should be integrated into
the job configuration.</span>

<span class="mark">Given an example of a pipeline template with the
configuration below.</span>

```
shared:
  image: node:10
  environment:
    VAR1: "one"
    VAR2: "two"
  steps:
    - init: npm install
    - test: npm test

jobs:
  main:
    requires: [~pr, ~commit]
  second:
    requires: [main]
```

<span class="mark">The configuration should be stored as follows:
removing the shared configuration and integrating it directly into the
individual job configurations.  
</span>

```
jobs:
    main:
        requires: [~pr, ~commit]
        image: node:10
        environment:
            VAR1: "one"
            VAR2: "two"
        steps:
            - init: npm install
            - test: npm test
    second:
        requires: [main]
        image: node:10
        environment:
            VAR1: "one"
            VAR2: "two"
        steps:
            - init: npm install
            - test: npm test
```

## Customizing Configuration at the Pipeline Level

### Cache

Given cache config in the pipeline template below:

```yaml
cache:
    pipeline: [~/versions]
    event: [$SD_SOURCE_DIR/node_modules]
    job:
        usejobcache: [/tmp/test]
```

and user defined pipeline below:

```yaml
cache:
    pipeline: [~/node_modules]
    job:
        docker-publish: [/tmp/artifacts]
```

the final config after merging should be:

```yaml
cache:
    pipeline: [~/node_modules]
    event: [$SD_SOURCE_DIR/node_modules]
    job:
        usejobcache: [/tmp/test]
        docker-publish: [/tmp/artifacts]
```

### Subscribe

Given subscribe config in the pipeline template below:

```yaml
subscribe:
    scmUrls:
        - git@github.com:vjap1/workflow.git: ['~commit', '~pr']
        - git@github.com:vjap3/workflow.git: ['~commit', '~pr']
```

and user defined pipeline below:

```yaml
subscribe:
    scmUrls:
        - git@github.com:vjap1/workflow.git: ['~pr']
        - git@github.com:vjap2/workflow.git: ['~commit', '~pr']
```

the final config after merging should be:

```yaml
subscribe:
    scmUrls:
        - git@github.com:vjap1/workflow.git: ['~pr']
        - git@github.com:vjap2/workflow.git: ['~commit', '~pr']
        - git@github.com:vjap3/workflow.git: ['~commit', '~pr']
```

### Parameters

Given parameters config in the pipeline template below:

```yaml
parameters:
    nameA: 'value1'
    nameB:
        value: 'value2'
        description: 'description of nameB'
    nameC: ['value1', 'value2']
```

and user defined pipeline below:

```yaml
parameters:
    nameB: 'value4'
    nameC: ['value1']
    nameD: 'value3'
```

the final config after merging should be:

```yaml
parameters:
    nameA: 'value1'
    nameB:
        value: 'value4'
        description: 'description of nameB'
    nameC: ['value1']
    nameD: 'value3'
```

### Annotations

Given annotations in the pipeline template below:

```yaml
annotations:
    screwdriver.cd/restrictPR: fork
```

and user defined pipeline below:

```yaml
annotations:
    screwdriver.cd/restrictPR: none
    screwdriver.cd/chainPR: true
```

the final config after merging should be:

```yaml
annotations:
    screwdriver.cd/restrictPR: none
    screwdriver.cd/chainPR: true
```

### Stages

### Shared

see [<u>customizing shared
configuration</u>](#customizing-shared-configuration)

### Jobs

see [<u>customizing jobs</u>](#customizing-jobs)

## Customizing jobs

#### Use Case 1: Adding a new job which is not part of the Pipeline Template

```yaml
template: example/mytemplate@1.2.3

jobs:
    main:
        requires: [~pr, ~commit]
        steps:
            - s1: echo 'added new job'

publish:
    requires: [main]
```

Note: we need to allow “requires” to be modified.

#### Use Case 2: Modifying a job that does not use a (job) template

1.  Which fields can be modified?

<table>
<colgroup>
<col style="width: 20%" />
<col style="width: 24%" />
<col style="width: 54%" />
</colgroup>
<thead>
<tr class="header">
<th>Field</th>
<th>Schema</th>
<th>Description</th>
</tr>
<tr class="odd">
<th rowspan="16"><p>annotations</p>
<p>blockedBy</p>
<p>cache</p>
<p>description</p>
<p>environment</p>
<p>freezeWindows</p>
<p>image</p>
<p>matrix</p>
<p>order</p>
<p>parameters</p>
<p>provider</p>
<p>requires</p>
<p>secrets</p>
<p>sourcePaths</p>
<p>steps</p>
<p>template</p></th>
<th rowspan="16"></th>
<th rowspan="16"></th>
</tr>
<tr class="header">
</tr>
<tr class="odd">
</tr>
<tr class="header">
</tr>
<tr class="odd">
</tr>
<tr class="header">
</tr>
<tr class="odd">
</tr>
<tr class="header">
</tr>
<tr class="odd">
</tr>
<tr class="header">
</tr>
<tr class="odd">
</tr>
<tr class="header">
</tr>
<tr class="odd">
</tr>
<tr class="header">
</tr>
<tr class="odd">
</tr>
<tr class="header">
</tr>
</thead>
<tbody>
</tbody>
</table>

1.  Similar to locking a step in the job template, Should we have a
    mechanism to prevent locking the entire or partial job
    configuration?

2.  What if we have steps defined in \`shared\` and

#### Use Case 3: Modifying a job that uses a (job) template

1.  Which attributes can be modified?

## Customizing shared configuration

## Nested Pipeline Template

## Trusted Template

## Pipeline Template Usage metrics

Goals

Users should be able to customize anything but pipeline template owners
can restrict what can be changed.

<table>
<colgroup>
<col style="width: 20%" />
<col style="width: 24%" />
<col style="width: 54%" />
</colgroup>
<thead>
<tr class="header">
<th>Attribute</th>
<th>Can it be modified?</th>
<th>Notes</th>
</tr>
<tr class="odd">
<th>annotations</th>
<th></th>
<th></th>
</tr>
<tr class="header">
<th>blockedBy</th>
<th></th>
<th></th>
</tr>
<tr class="odd">
<th>cache</th>
<th></th>
<th></th>
</tr>
<tr class="header">
<th>description</th>
<th></th>
<th></th>
</tr>
<tr class="odd">
<th>environment</th>
<th></th>
<th></th>
</tr>
<tr class="header">
<th>freezeWindows</th>
<th></th>
<th></th>
</tr>
<tr class="odd">
<th>image</th>
<th></th>
<th></th>
</tr>
<tr class="header">
<th>matrix</th>
<th></th>
<th></th>
</tr>
<tr class="odd">
<th>order</th>
<th></th>
<th></th>
</tr>
<tr class="header">
<th>parameters</th>
<th></th>
<th></th>
</tr>
<tr class="odd">
<th>provider</th>
<th></th>
<th></th>
</tr>
<tr class="header">
<th>requires</th>
<th></th>
<th></th>
</tr>
<tr class="odd">
<th>secrets</th>
<th></th>
<th></th>
</tr>
<tr class="header">
<th>sourcePaths</th>
<th></th>
<th></th>
</tr>
<tr class="odd">
<th>steps</th>
<th></th>
<th></th>
</tr>
<tr class="header">
<th>template</th>
<th></th>
<th></th>
</tr>
</thead>
<tbody>
</tbody>
</table>