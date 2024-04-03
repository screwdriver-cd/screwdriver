/**
 * TODO In the future, this file will be moved to 'screwdriver-models'
 */
// -----------------------------------------------------------------------------
//      screwdriver-models.PipelineModel
// -----------------------------------------------------------------------------
/**
 * PipelineModel is defined in 'screwdriver-models/lib/pipeline.js'
 *
 * @description import {PipelineModel} from 'screwdriver-models/lib/pipeline'
 */
export type PipelineModel = {
    id: number;
    name: string;
    scmUri: string;
    scmContext: string;
    scmRepo: ScmRepo;
    createTime: string;
    admins: Record<string, boolean>,
    workflowGraph: WorkflowGraph;
    annotations: {};
    lastEventId: number;
    configPipelineId: undefined;
    childPipelines: undefined;
    prChain: boolean;
    parameters: {};
    settings: {};
    state: string;
    subscribedScmUrlsWithActions: Array<unknown>
    badges: undefined;
    templateVersionId: undefined;

    // symbol
    '[symbol(model)]': undefined;
    '[symbol(table)]': undefined;
    '[symbol(datastore)]': undefined;
    '[symbol(scm)]': ScmRouter;
    '[symbol(multiBuildClusterEnabled)]': boolean;
    '[symbol(row data)]': undefined;
    '[symbol(dirty variable)]': Array<string>;
    // functions
    getConfiguration: () => unknown;
    addWebhooks: () => unknown;
    syncPRs: () => unknown;
    syncPR: () => unknown;
    sync: () => unknown;
    admin: Promise<UserModel>
    tokens: Promise<unknown>
    getFirstAdmin: () => unknown;
    getFirstRepoAdmin: () => unknown;
    token: Promise<unknown>
    branch: Promise<unknown>
    rootDir: Promise<unknown>
    openPullRequests: Promise<unknown>
    pipelineJobs: Promise<unknown>
    pullRequestJobs: Promise<unknown>
    secrets: Promise<unknown>
    configPipeline: () => unknown;
    getJobs: () => unknown;
    getEvents: () => unknown;
    getBuilds: () => unknown;
    update: () => unknown;
    remove: () => unknown;
    getMetrics: () => unknown;
    chainPR: () => boolean;
};

// -----------------------------------------------------------------------------
//      screwdriver-models.Job
// -----------------------------------------------------------------------------
/**
 * Job is defined in 'screwdriver-models/lib/job.js'
 *
 * @description import {Job} from 'screwdriver-models/lib/job'
 */
export type Job = {
    // property
    title: undefined;
    createTime: undefined;
    username: undefined;
    userProfile: undefined;
    url: undefined;
    id: number;
    name: string;
    prParentJobId: undefined;
    permutations: Array<Permutation>;
    description: undefined;
    pipelineId: number;
    state: string;
    stateChanger: undefined;
    stateChangeTime: undefined;
    stateChangeMessage: undefined;
    archived: boolean;
    templateId: undefined;

    // symbol
    '[symbol(model)]': undefined;
    '[symbol(table)]': undefined;
    '[symbol(datastore)]': undefined;
    '[symbol(scm)]': undefined;
    '[symbol(multiBuildClusterEnabled)]': undefined;
    '[symbol(row data)]': undefined;
    '[symbol(dirty variable)]': undefined;
    '[symbol(executor)]': undefined;
    '[symbol(tokenGen)]': undefined;
    '[symbol(apiUri)]': undefined;

    // functions
    pipeline: Promise<unknown>
    secrets: Promise<unknown>
    isPR: () => unknown;
    parsePRJobName: () => unknown;
    prNum: object;
    getBuilds: () => unknown;
    getRunningBuilds: () => unknown;
    getLatestBuild: () => unknown;
    update: () => unknown;
    remove: () => unknown;
    getMetrics: () => unknown;
};

// -----------------------------------------------------------------------------
//      screwdriver-models.Job
// -----------------------------------------------------------------------------
/**
 * BuildModel is defined in 'screwdriver-models/lib/build.js'
 *
 * @description import {BuildModel} from 'screwdriver-models/lib/build'
 */
export type BuildModel = {
    // property
    id: number;
    environment: Array<Record<string, string>>;
    eventId: number;
    jobId: number;
    parentBuildId: Array<number>,
    parentBuilds: ParentBuilds;
    number: number;
    container: string;
    cause: string;
    sha: string;
    subscribedConfigSha: undefined;
    createTime: string;
    startTime: string;
    endTime: string;
    parameters: undefined;
    meta: {
        build: {
            buildId: string;
            eventId: string;
            jobId: string;
            jobName: string;
            pipelineId: string;
            sha: string;
        };
        commit: {
            author: {
                avatar: string;
                id: string;
                name: string;
                url: string;
                username: string;
            };
            changedFiles: string;
            committer: {
                avatar: string;
                id: string;
                name: string;
                url: string;
                username: string;
            };
            message: string;
            url: string;
        };
        event: {
            creator: string;
        };
    };
    status: string;
    statusMessage: undefined;
    stats: object;
    templateId: undefined;
    buildClusterName: undefined;

    // symbol
    '[symbol(model)]': undefined;
    '[symbol(table)]': undefined;
    '[symbol(datastore)]': undefined;
    '[symbol(scm)]': ScmRouter;
    '[symbol(multiBuildClusterEnabled)]': boolean;
    '[symbol(row data)]': undefined;
    '[symbol(dirty variable)]': undefined;
    '[symbol(executor)]': undefined;
    '[symbol(apiUri)]': undefined;
    '[symbol(tokenGen)]': undefined;
    '[symbol(uiUri)]': undefined;

    // functions
    updateCommitStatus: () => unknown;
    getSteps: () => unknown;
    job: Promise<unknown>
    pipeline: Promise<unknown>
    secrets: Promise<unknown>
    start: () => unknown;
    update: () => unknown;
    remove: () => unknown;
    stop: () => unknown;
    stopFrozen: () => unknown;
    unzipArtifacts: () => unknown;
    isDone: () => unknown;
    getMetrics: () => unknown;
    toJsonWithSteps: () => unknown;
};

// -----------------------------------------------------------------------------
//      screwdriver-models.EventModel
// -----------------------------------------------------------------------------
/**
 * EventModel is defined in 'screwdriver-models/lib/event.js'
 *
 * @description import {EventModel} from 'screwdriver-models/lib/event'
 */
export type EventModel = {
    // property
    id: number;
    parentEventId: undefined;
    groupEventId: number;
    causeMessage: string;
    commit: Commit;
    createTime: string;
    creator: Creator;
    meta: Meta;
    pipelineId: number;
    sha: string;
    configPipelineSha: undefined;
    startFrom: string;
    type: string;
    workflowGraph: WorkflowGraph;
    pr: object;
    prNum: undefined;
    baseBranch: string;

    // symbol
    '[symbol(model)]': undefined;
    '[symbol(table)]': undefined;
    '[symbol(datastore)]': undefined;
    '[symbol(scm)]': ScmRouter;
    '[symbol(multiBuildClusterEnabled)]': undefined;
    '[symbol(row data)]': undefined;
    '[symbol(dirty variable)]': undefined;

    // functions
    getStageBuilds: () => unknown;
    getBuilds: () => unknown;
    getMetrics: () => unknown;
};

// -----------------------------------------------------------------------------
//      screwdriver-models.UserModel
// -----------------------------------------------------------------------------
/**
 * UserModel is defined in 'screwdriver-models/lib/user.js'
 *
 * @description import {UserModel} from 'screwdriver-models/lib/user'
 */
export type UserModel = {
    id: number;
    username: string;
    token: string;
    scmContext: string;
    settings: Record<string, settings>;
}

// -----------------------------------------------------------------------------
//      screwdriver-models.StageModel
// -----------------------------------------------------------------------------
/**
 * StageModel is defined in 'screwdriver-models/lib/stage.js'
 *
 * @description import {StageModel} from 'screwdriver-models/lib/stage'
 */
export type StageModel = object;

// -----------------------------------------------------------------------------
//      Dependencies
// -----------------------------------------------------------------------------
type WorkflowGraph = {
    nodes: Array<WorkflowGraphNode>,
    edges: Array<WorkflowGraphEdges>,
};
type WorkflowGraphNode = {
    name: string;
    id: number | undefined;
};
type WorkflowGraphEdges = {
    src: string;
    dest: string;
    join: boolean | undefined;
};
type ScmRepo = {
    branch: string;
    name: string;
    url: string;
    rootDir: string;
    private: boolean;
}

/**
 * ScmRouter is defined in 'screwdriver-scm-router/index.js'
 *
 * @description import {ScmRouter} from 'screwdriver-scm-router/index'
 */
type ScmRouter = {
    // property
    config: undefined;
    scms: Record<string, {
        // property
        config: {
            // property
            displayName: string;
            username: string;
            email: string;
            secret: string;
            oauthClientId: string;
            oauthClientSecret: string;
            privateRepo: boolean;
            gheProtocol: string;
            autoDeployKeyGeneration: boolean;
            readOnly: object;
            https: boolean;
            fusebox: object;
            gheCloud: boolean;
            githubGraphQLUrl: string;
        };
        octokitConfig: object;
        breaker: {
            // property
            command: () => unknown;
            breakerOptions: {
                // property
                timeout: number;
                maxFailures: number;
                resetTimeout: number;
                errorFn: () => unknown;
            };
            retryOptions: {
                // property
                retries: number;
                factor: number;
                minTimeout: number;
                maxTimeout: number;
                randomize: boolean;
            };
            shouldRetry: () => unknown;
            breaker: () => unknown;
            // symbol
            '[symbol(kCapture)]': undefined;
            // functions
            runCommand: () => unknown;
            isClosed: () => unknown;
            getTotalRequests: () => unknown;
            getTimeouts: () => unknown;
            getSuccessfulRequests: () => unknown;
            getFailedRequests: () => unknown;
            getConcurrentRequests: () => unknown;
            getAverageRequestTime: () => unknown;
            forceOpen: () => unknown;
            stats: () => unknown;
        };
        scmGithubGQL: object;

        // functions
        lookupScmUri: () => unknown;
        promiseToWait: () => unknown;
        waitPrMergeability: () => unknown;
        prComments: () => unknown;
        editPrComment: () => unknown;
        generateDeployKey: () => unknown;
        stats: () => unknown;
    }>;
    // functions
    loadPlugin: () => unknown;
    chooseWebhookScm: () => unknown;
    chooseScm: () => unknown;
    allScm: () => unknown;
    autoDeployKeyGenerationEnabled: () => unknown;
    stats: () => unknown;
    getDisplayName: () => unknown;
    getReadOnlyInfo: () => unknown;
}

type Permutation = {
    annotations: Record<string, number | string | boolean>;
    commands: Array<Command>
    environment: Array<string>;
    image: string;
    secrets: Array<unknown>,
    settings: object;
    requires: Array<string>,
}

type Command = {
    name: string;
    command: string;
}

type ParentBuilds = Record<string, ParentBuild>;

export type ParentBuild = {
    eventId: number;
    jobs: Record<string, number>,
}

type Creator = {
    id: string;
    avatar: string;
    name: string;
    username: string;
    url: string;
}

type Commit = {
    author: {
        id: string;
        avatar: string;
        name: string;
        username: string;
        url: string;
    };
    committer: {
        id: string;
        avatar: string;
        name: string;
        username: string;
        url: string;
    };
    message: string;
    url: string;
}

type Meta = {
    build: {
        buildId: string;
        eventId: string;
        jobId: string;
        jobName: string;
        pipelineId: string;
        sha: string;
    };
    commit: {
        author: {
            avatar: string;
            id: string;
            name: string;
            url: string;
            username: string;
        };
        changedFiles: string;
        committer: {
            avatar: string;
            id: string;
            name: string;
            url: string;
            username: string;
        };
        message: string;
        url: string;
    };
    event: {
        creator: string;
    };
}

type settings = {
    showPRJobs: boolean;
}
