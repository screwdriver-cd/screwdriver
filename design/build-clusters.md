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
	3. Authorization (initial phase will support JWT with key and sign options) - Cluster is registered with the publickey and signOptions provided by team managing the cluster.
	4. SCM Context - git url (github.com or git.ouroath.com). Applicable to only explicit build clusters which are non SD managed.
	5. SCM Organization - git organizations. Will be used to validate if job has permission to run on build cluster which is requesting. Applicable to only explicit build clusters which are non SD managed.
	6. Managed by (Screwdriver / External) - Cluster is managed by screwdriver team or external team.  

Multiple build cluster onboarding process doc 
	TBD

## Design

Redis queue in buildClusters

![build-clusters-design.png](diagrams/build-clusters-design.png)


### Scheduler service will be responsible 
	1. identify build cluster and queue information for a build and queue jobs in respective queues.

	2. authorize queue worker from build cluster and allow only authorized jobs from queues for respective build cluster.

### Authentication & Authorization
Initial phase, we will go with JWT + private and public key authorization. Token expiry will be passed as part of signOption. Periodically cycle private+public key and signOption which has the expiry interval, and this will be a manual step which needs to be co-ordinated between Build cluster admin and Screwdriver team.

UI, API to Scheduler service  - will follow the existing JWT authentication and authorization mechanism.

Queue worker to Scheduler service - Build cluster will pass JWT token encrypted with private key and sign option. Queue worker from build cluster need to identify itself with cluster detail. 

#### Example: 

1. Queue worker invokes `jobs/:buildCluster` api 

2. Create JWT token with below information and pass it alongwith `jobs/:buildCluster` api header.

    1. Payload: { buildCluster: colo1 }
    2. Secret: privatekey
    3. SignOption: algorithm, expiry, etc.

3. Scheduler service 
    1. gets buildCluster name from the jobs api parameter
    2. gets respective buildCluster public key based on the buildCluster name from #1 
    3. Verifies JWT sent by queue worker
    4. if legit, then decodes the JWT content 
    5. pulls message from the respective queue
    6. responds back build info to be processed to queue worker.   

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
Table: `buildClusters`

Columns:

| Name | Type | Nullable | Primary Key | Unique | Description
| --- | --- | --- | --- | --- | --- |
| `id` | integer | no | yes | yes | |
| `name` | text (100) | no | no | yes | |
| `scmOrganizations` | text(500) | yes | no | no | |
| `scmContext` | text(200) | no | yes | no | |
| `isActive` | boolean | no | no | no | *0-false or 1-true* |
| `authKey` | text(100) | no | no | yes | *environment variable name of buildCluster publicKey. Note: every buildCluster publicKey will have unique environment variable name* |
| `signOption` | text(100) | no | no | yes | *environment variable name of buildCluster signOption. Note: every buildCluster publicKey will have unique environment variable name* |
| `managedBy` | text(50) | no | no | no | cluster managed by *screwdriver or external* |
| `managedByEmail` | text(100) | yes | no | no | cluster admin email for communications |

Unique constraint: `name + isActive` 

#### Sample record

| id | name | scmContext | scmOrganizations | isActive | authKey |  signOption | managedBy 
| --- | --- | --- | --- | --- | --- | --- | --- | 
| 1 | gq1 | github:git.ouroath.com | null | 0 | *gq1_sdpublickey* | *gq1_sign* | screwdriver
| 2 | bf1 | github:git.ouroath.com | null | 1 | *bf1_sdpublickey* | *bf1_sign* | screwdriver
| 3 | identity | github:git.ouroath.com | identity_org1, identity_org2 | 1 | *identity_publickey* | *identity_sign* | external
| 4 | identity | github:git.ouroath.com | identity_org1, identity_org2 | 0 | *identity_publickey* | *identity_sign* | external
| 5 | iOS | github:git.ouroath.com | iOS_org1, iOS_org2 | 1 | *iOS_publickey* | *iOS_sign* | external

### Cache server to store active *buildClusters* in memory when the service boot up. 

### Queue

Redis queue (Master) - It will hold queues for all build clusters. 

Redis queue (Build Cluster) - It will hold queue for that particular build cluster.


### Below listed apis need to be built to manage the cluster details

| Method | url | Description
| --- | --- | ---
| `POST` | ` /buildClusters ` | ` { "name":"iOS", "scmContext":"github:git.ouroath.com", "scmOrganizations": "iOS_org1", "isActive":1, "authKey": "iOS_publickey", "signOption": "iOS_sign", "managedBy": "screwdriver" } `
| `GET` | `	/buildClusters ` | ` get list of buildClusters info `
| `GET` | `	/buildClusters/:name ` | ` get a particular buildCluster info `
| `DELETE` | ` /buildClusters/:name ` | ` delete buildCluster `


## Flow
### Screwdriver API to Scheduler service

	1. Screwdriver UI / PR commit / Merge triggers new build via Screwdriver API
	2. Screwdriver API inturn calls Scheduler service with appropriate build details to schedule a job
	3. Authentication via JWT token (refer Authorization section)
	4. Scheduler service queries `buildClusters` table for active records with cluster name from build info and validate if job can be scheduled in apropriate buildCluster queue
	5. one (or) more record exist, then assign job to the queue identified by generating a random number within given boundaries, which is the returned list size of records
	6. no records, then query `clusters` table for active records with managedBy=screwdriver
	7. repeat step #4
	8. Update build info with cluster details

### Queue worker to Scheduler service  
    
    1. Queue worker will poll from Scheduler service periodically to get new build jobs from Redis queue (master)
    2. Authentication via JWT token (refer Authorization section) 
    3. Scheduler service will push build jobs from Redis queue (master) which are not blocked by other jobs  
    4. Queue worker will push build jobs to Redis queue (internal to build cluster)
    5. For any failures till #3, build jobs will not be removed from Redis queue (master)
    6. On success of #3, build jobs will be removed from Redis queue (master)
    7. Queue worker will poll Redis queue (internal to build cluster) and push to Kubernetes
    8. Failures will be handled as its handled now     
