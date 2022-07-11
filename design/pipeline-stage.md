## Status
- July 11, 2022: Proposal submitted

## Context

Current Screwdriver reacts and send user notifications based on single job's status from a given pipeline, and it lacks of way of reacting to a group of jobs' status changes. For example, 

```
Pipeline1: 

[jobA] --> [jobB, jobC]
       \               
        -> [jobD, jobE]
```

We can get notifications from any individual jobs `A,B,C,D,E`, but there's no way to get notifications when both job B and C finish, and there's no way to get notifications when all jobs `A,B,C,D,E` finish. Users can setup an "end job" to make sure that is the downstream job, i.e. `jobF`

```
Pipeline1: 

[jobA] --> [jobB, jobC] -> [jobF]
       \                /
        -> [jobD, jobE]/
```

So, when `jobF`'s status changes, users will get a notification, which implies all jobs `A,B,C,D,E`'s statuses were updated.


## Proposal

We see this as an unpleasant developer experience issue and propose to add a notion of "stage" into the pipeline. 

So users can:

1) Create logical groupings with jobs
2) See visual aids on the UI to reflect these groupings
3) Eliminate the need to create a single dangling job for notification purposes


### Terminology & Definitions

Stage: A subset of jobs from a given pipeline.

Pipeline can have multiple stages. 

Job can belong to any stage from the same pipeline.

Stage's definition is scoped to an event.

### Caveats

Stages must be defined in the screwdriver.yaml at the Source Directory level, and PR events do not have a notion of stages.

The current/latest pipeline stages are defined in the latest commit of Source Directory, if there's an event associated with it. For pipelines without any events, the stages are null even though the SCM has corresponding stage definition in the screwdriver.yaml.

### Usage

A simple example is shown below

```
jobs:
  job1:
    requires: [~pr, ~commit]
    image: node:14
    steps:
      - init: echo 'init'
  job2:
    requires: [~pr, ~commit]
    image: node:14
    steps:
      - init: echo 'init'
  job3:
    requires: [~pr, ~commit]
    image: node:14
    steps:
      - init: echo 'init'

stages:
  starfish:
    jobs: [job1, job2]
    description: "these are starfish jobs"
    # description: optional
    # color: optional
```

#### Attributes

description: optional, a string of text to describe what this stage is. 

color: optional, a hex presentation of color value for this stage to be displayed on the UI, if not present, UI will present its color in the default [color sequence](NEED to update the link). 

jobs: list of job names that belong to a stage; one job should not be in multiple stages

## Details

Stage Table

| id |jobIds | name | eventId |pipelineId | Other metadata|
|---|---|---|---|---|---|
|1|[1,3,4](jobIds dont change) |canary |null |p1| {color: description:, etc,.}|
|2|[p2_1,p2_3](jobIds dont change) |canary|e1 |p2 | {color: description:, etc,.}|
|3|[1,3,4] (jobIds dont change)|production|null|p1| {color: description:, etc,.}|
|4|[1,3,4] (jobIds dont change)|production|e2|p1|  {color: description:, etc,.}|

`Event` and `Pipeline` table can reference the Stage table's eventId and pipelineId column to retrieve data.

The latest stages from the given pipeline. When an event starts, 

- Create one stage table row with corresponding eventId, 
- if it's triggered from the latest commit, and check if there's a corresponding pipelineId with eventId to be `null`, 
	- if it does not exist, create another row with eventId to be null to indicate this is the latest eventId for the given pipeline
	- if it does exist, update the definition from that row to reflect the latest changes
- if it was not triggered from the latest commit, meaning it was a start from an existing event, including the restart of a given event, then we create a new event with parentEvent set, set the definition of the stage from retrieving the old stage definition, no extra step needed for set the stages.
	

So, we have the following API exposed: 

`pipelines/:id/stages` 

The stage from the particular event of a given pipeline:

`pipelines/:id/events/:eventId/stages`


## Future Work

Similar to [job's settings](https://docs.screwdriver.cd/user-guide/configuration/settings) definition, `stage` can trigger email/slack notifications based on the condition specified in the settings.

```
jobs:
  job1:
    requires: [~pr, ~commit]
    image: node:14
    steps:
      - init: echo 'init'
  job2:
    requires: [~pr, ~commit]
    image: node:14
    steps:
      - init: echo 'init'
  job3:
    requires: [~pr, ~commit]
    image: node:14
    steps:
      - init: echo 'init'

stages:
  starfish:
    jobs: [job1, job2]
    description: "these are starfish jobs"
    settings:
	  email:
       addresses: [test@email.com, test2@email.com]
       statuses: [SUCCESS, FAILURE]
  seahorse:
    jobs: [job3]
    description: "these are seahorse jobs"
    settings:
      email: [test@email.com, test2@email.com]
      slack: 'mychannel'
```


Other jobs can depend on stages, and stages can trigger other jobs within the same pipeline.
 

i.e. 

```
jobs:
  job1:
    requires: [~pr, ~commit]
    image: node:14
    steps:
      - init: echo 'init'
  job2:
    requires: [~pr, ~commit]
    image: node:14
    steps:
      - init: echo 'init'
  job3:
    requires: [@starfish]
    image: node:14
    steps:
      - init: echo 'init'

stages:
  starfish:
    jobs: [job1, job2]
    description: "these are starfish jobs"
```

