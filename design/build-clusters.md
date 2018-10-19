# Multiple Build Cluster 

## Context

Build a scalable Screwdriver build infrastructure. 

## Objective 

1. Running builds in multiple build clusters to support high availability
2. Users can bring in their own build clusters for their own specific infrastructure needs.
3. Support build cluster in AWS

## Proposal

1. Implicit build clusters
	Screwdriver maintains its own multiple build cluster infrastructure.

2. Explicit build clusters
	Users can bring in their own build cluster infrastructure. 
	
This can also be Screwdriver maintained specialized cluster where all users have access. Eg: Mobile iOS cluster or Windows cluster.
	

As part of cluster onboarding process for above both options cluster admin should register their build cluster information with Screwdriver. Below details are required to register a build cluster.

	1. Cluster name - Cluster name provided by the client
	2. isActive - Cluster status whether its active or inactive. This will be used to route / pause. Initially this will be a manual update of cluster health.
	3. Authorization - Authorize using user credentials and queue details.
	4. SCM Context - git url (github.com or git.ouroath.com). Applicable to only explicit build clusters which are non SD managed.
	5. SCM Organization - git organizations. Will be used to validate if job has permission to run on build cluster which is requesting. Applicable to only explicit build clusters which are non SD managed.
	6. Managed by (Screwdriver / External) - Cluster is managed by screwdriver team or external team.  


## Design

![build-clusters-design-queue.png](diagrams/build-clusters-design-queue.png)


### Responsibilities  
	1. Scheduler service will identify build cluster and queue information for the build.
	2. Scheduler service will push build job to queue from redis, after successfully validating blockedBy and other checks.
	3. Build cluster queue worker will consume/poll from its respective queue.
	4. Queue authorization (acls) will authorize the build cluster queue worker request.


### Authentication & Authorization
UI, API to Scheduler service - will follow the existing JWT authentication and authorization mechanism. 

Scheduler service to queue - Scheduler service will be authorized with admin privileges to access all queues.  

Build cluster queue worker to queue - build cluster will be registered and authorized to a queue or set of queues. Queue worker from build cluster will connect to queue using authorized user credentials and consume jobs from the queue on successful authorization.   


### Queue setup
TBD

### Yaml 

```yml
shared:
    environment:
    NODE_ENV: test
    settings:
        email:
    addresses: [test@email.com, test2@email.com]
    statuses: [SUCCESS, FAILURE]
    annotations:
        buildCluster: iOS
jobs:
    main:
        requires: [~pr, ~commit]
        sourcePaths: ["src/app/", "screwdriver.yaml"]
        image: node:6
        steps:
    - init: npm install
    - test: npm test
    publish:
    requires: main
    image: node:6
    steps:
        - publish: npm publish
    ...
```


### New table for build cluster details
Table: `buildCluster`

Columns:

| Name | Type | Nullable | Primary Key | Unique | Description
| --- | --- | --- | --- | --- | --- |
| `id` | integer | no | yes | yes | |
| `name` | text (100) | no | no | yes | |
| `scmOrganizations` | text(500) | yes | no | no | |
| `scmContext` | text(200) | no | yes | no | |
| `isActive` | boolean | no | no | no | *0-false or 1-true* |
| `managedBy` | text(50) | no | no | no | cluster managed by *screwdriver or external* |
| `managedByEmail` | text(100) | yes | no | no | cluster admin email for communications |

Unique constraint: `name + isActive` 

#### Sample record

| id | name | scmContext | scmOrganizations | isActive | managedBy | managedByEmail 
| --- | --- | --- | --- | --- | --- | --- | --- | --- | 
| 1 | gq1 | github:git.ouroath.com | null | 0 | screwdriver | sd@oath.com
| 2 | bf1 | github:git.ouroath.com | null | 1 | screwdriver | sd@oath.com
| 3 | identity | github:git.ouroath.com | identity_org1, identity_org2 | 1 | external | identity@oath.com
| 4 | identity | github:git.ouroath.com | identity_org1, identity_org2 | 0 | external | identity@oath.com
| 5 | iOS | github:git.ouroath.com | iOS_org1, iOS_org2 | 1 | external | ios@oath.com

### Cache server to store active *buildClusters* in memory when the service boot up. 

### Below listed apis need to be built to manage the cluster details

| Method | url | Description
| --- | --- | ---
| `POST` | ` /buildClusters ` | ` { "name":"iOS", "scmContext":"github:git.ouroath.com", "scmOrganizations": "iOS_org1", "isActive":1, "managedBy": "screwdriver" } `
| `GET` | `	/buildClusters ` | ` get list of buildClusters info `
| `GET` | `	/buildClusters/:name ` | ` get a particular buildCluster info `
| `DELETE` | ` /buildClusters/:name ` | ` delete buildCluster `


### Cluster on-board

1. Build cluster admin requesting access with cluster info and user credentials
2. buildCluster table populated with cluster info
3. SD admin to create queue based on #1
4. SD admin authorize build cluster user and queue 


## Flow
### SD Validator

	1. SD validator should validate if the annotated buildCluster in yaml is onboarded and active. 
	
### Screwdriver API to Scheduler service

	1. Screwdriver UI / PR commit / Merge triggers new build via Screwdriver API
	2. Screwdriver API inturn calls Scheduler service with appropriate build details to schedule a job
	3. Authentication via JWT token (refer Authorization section)
	4. Scheduler service queries `buildClusters` cache for active records with cluster name from build info and validate if job can be scheduled in appropriate buildCluster queue
	5. one (or) more record exist, then assign job to the queue identified by generating a random number within given boundaries, which is the returned list size of records
	6. no records, then query `clusters` table for active records with managedBy=screwdriver
	7. repeat step #4
	8. Update build info with cluster and queue details

### Queue worker to Scheduler service  
    
	1. Build cluster queue worker will consume/poll jobs from queue. 
	2(a). On successful authorization, job will be consumed. 
	2(b). On authorization failures, queue will reject consume/poll request.
	3. Jobs will be processed in build cluster.
	3(a). On successful acknowledgement in build cluster, offset will be committed and step #1 will be repeated.
	3(b). On acknowledgement failures in build cluster, process will be retried for specific # of times before giving up and Offset will be committed and step #1 will be repeated.

	note: in future, 3(b) will be changed to implement failure queues and process messages from failure queues

	