'use strict';

/* eslint max-classes-per-file: off */

const configParser = require('screwdriver-config-parser').parsePipelineTemplate;
const fs = require('fs');
const { Server } = require('@hapi/hapi');
const sinon = require('sinon');
const { assert } = require('chai');
const { getStageFromSetupJobName } = require('screwdriver-models/lib/helper');

/**
 * Mock models for code completion
 * (Not implement methods)
 */
class Pipeline {
    constructor() {
        this.id = 1;
        this.workflowGraph = {
            edges: [],
            nodes: []
        };
    }

    /**
     * Test method: get <jobName> builds belonging to this pipeline
     * @param {String} jobName
     * @returns {Build[]}
     */
    getBuildsOf(jobName) {
        assert.fail(`For code completion: getBuildsOf(${jobName})`);
    }

    /**
     * Test method: get latest event belonging to this pipeline
     * @param {void}
     * @returns {Event}
     */
    getLatestEvent() {
        assert.fail(`For code completion: getLatestEvent()`);
    }
}

class Event {
    constructor() {
        this.id = 1;
        this.workflowGraph = {
            edges: [],
            nodes: []
        };
    }

    /**
     * Test method: create restart event
     * @param {String} jobName
     * @returns {Promise<Event>}
     */
    async restartFrom(jobName) {
        assert.fail(`For code completion: restartFrom(${jobName})`);
    }

    /**
     * Test method: run all builds belonging to this event
     * @param {void}
     * @returns {Promise}
     */
    async run() {
        assert.fail(`For code completion: run()`);
    }

    /**
     * Test method: get <jobName> build belonging to this event
     * @param {String} jobName
     * @returns {Build}
     */
    getBuildOf(jobName) {
        assert.fail(`For code completion: getBuildOf(${jobName})`);
    }
}

class Job {
    constructor() {
        this.id = 1;
        this.pipeline = new Pipeline();
    }
}

// eslint-disable-next-line no-unused-vars
class Build {
    constructor() {
        this.id = 1;
        this.isStarted = false;
        this.status = 'CREATED';
        this.job = new Job();
        this.event = new Event();
    }

    /**
     * Test method: Send "PUT /builds/{id}" to update build status to <status>
     * @param {String} status
     * @returns {Promise}
     */
    async complete(status) {
        assert.fail(`For code completion: complete(${status})`);
    }
}

// eslint-disable-next-line no-unused-vars
class CustomServer extends Server {
    constructor(config) {
        super(config);

        this.app = {
            buildFactory: new BuildFactoryMock(), // eslint-disable-line no-use-before-define
            pipelineFactory: new PipelineFactoryMock(), // eslint-disable-line no-use-before-define
            eventFactory: new EventFactoryMock(), // eslint-disable-line no-use-before-define
            stageBuildFactory: new StageBuildFactoryMock(), // eslint-disable-line no-use-before-define
            stageFactory: new StageFactoryMock(), // eslint-disable-line no-use-before-define
            jobFactory: new JobFactoryMock(), // eslint-disable-line no-use-before-define
            triggerFactory: new TriggerFactoryMock() // eslint-disable-line no-use-before-define
        };
    }
}

/**
 * Mock factories
 * Records are saved into arrays
 */
class TriggerFactoryMock {
    /**
     * @param {CustomServer} server
     */
    constructor(server) {
        this.server = server;
        this.records = {};
    }

    create({ src, dest }) {
        if (!this.records[src]) {
            this.records[src] = [];
        }

        this.records[src].push(dest);
    }

    getDestFromSrc(src) {
        return this.records[src] || [];
    }
}

class PipelineFactoryMock {
    /**
     * @param {CustomServer} server
     */
    constructor(server) {
        this.server = server;
        this.records = [null];
    }

    /**
     * Mock method: Create pipeline
     * @param {Object} config
     * @returns {Pipeline}
     */
    async create(config) {
        const pipeline = {
            ...config,
            id: this.records.length,
            admin: {
                unsealToken: sinon.stub().resolves('token')
            },
            toJson: sinon.stub()
        };

        pipeline.toJson.returns({ ...pipeline });

        const { jobs, stages, workflowGraph } = pipeline;

        Object.keys(jobs).forEach(name => {
            jobs[name] = this.server.app.jobFactory.create({
                name,
                pipeline,
                pipelineId: pipeline.id
            });
        });

        Object.keys(stages || {}).forEach(name => {
            stages[name] = this.server.app.stageFactory.create({
                setup: {
                    image: 'node:20',
                    steps: []
                },
                teardown: {
                    image: 'node:20',
                    steps: []
                },
                ...stages[name],
                pipelineId: pipeline.id,
                name,
                archived: false
            });
        });

        workflowGraph.edges.forEach(edge => {
            const { src } = edge;
            const dest = `~sd@${pipeline.id}:${edge.dest}`;

            if (src.startsWith('~sd@') || src.startsWith('sd@')) {
                this.server.app.triggerFactory.create({ src, dest });
            }
        });

        pipeline.getBuildsOf = jobName => {
            return (
                this.server.app.buildFactory.records.filter(build => {
                    return build && build.job.name === jobName && build.job.pipelineId === pipeline.id;
                }) || null
            );
        };

        pipeline.getLatestEvent = () => {
            const events = this.server.app.eventFactory.records.filter(event => {
                return event && parseInt(event.pipelineId, 10) === parseInt(pipeline.id, 10);
            });

            return events.slice(-1)[0] || null;
        };

        this.records.push(pipeline);

        await this.syncTriggers();

        return pipeline;
    }

    get(id) {
        return this.records[Number(id)];
    }

    /**
     * Test method: create pipeline from yaml file
     * @param {String} fileName
     * @returns {Promise<Pipeline>}
     */
    async createFromFile(fileName) {
        const yaml = fs.readFileSync(`${__dirname}/data/trigger/${fileName}`).toString();

        const pipeline = await configParser({ yaml });

        pipeline.yaml = yaml;

        return this.create(pipeline);
    }

    /**
     * Test method: sync remote triggers
     * @param {void}
     * @returns {void}
     */
    async syncTriggers() {
        for (let i = 1; i < this.records.length; i += 1) {
            const pipeline = this.records[i];

            const { workflowGraph } = await configParser({
                yaml: pipeline.yaml,
                triggerFactory: this.server.app.triggerFactory,
                pipelineId: pipeline.id
            });

            workflowGraph.nodes.forEach(node => {
                let pipelineId = pipeline.id;
                let { name } = node;

                if (name.startsWith('sd@') || name.startsWith('~sd@')) {
                    const [l, r] = name.split(':');

                    pipelineId = l.replace('~', '').replace('sd@', '');
                    name = r;
                }

                const job = this.server.app.jobFactory.get({ pipelineId, name });

                if (job) {
                    node.id = job.id;
                }
            });

            pipeline.workflowGraph = workflowGraph;
        }
    }
}

class EventFactoryMock {
    /**
     * @param {CustomServer} server
     */
    constructor(server) {
        this.server = server;
        this.records = [null];
        this.scm = {
            getCommitSha: sinon.stub().resolves('github:github.com')
        };
    }

    /**
     * Mock method: Create event
     * @param {Object} config
     * @returns {Promise<Event>}
     */
    async create(config) {
        const event = {
            groupEventId: this.records.length,
            ...config,
            id: this.records.length,
            pr: {},
            update: sinon.stub(),
            toJson: sinon.stub()
        };

        const pipeline = this.server.app.pipelineFactory.get(event.pipelineId);

        event.workflowGraph = pipeline.workflowGraph;
        event.getBuilds = () => {
            return this.server.app.buildFactory.records.filter(build => {
                return build && parseInt(build.eventId, 10) === parseInt(event.id, 10);
            });
        };
        event.getStageBuilds = async () => {
            return this.server.app.stageBuildFactory.records.filter(build => {
                return build && parseInt(build.eventId, 10) === parseInt(event.id, 10);
            });
        };
        event.update.returns(event);
        event.toJson.returns({ ...event });

        // Test methods
        event.restartFrom = async jobName => {
            const restartBuild = event.getBuildOf(jobName);

            const restartEvent = await this.create({
                pipelineId: pipeline.id,
                groupEventId: event.groupEventId || event.id,
                parentEventId: event.id,
                parentBuilds: restartBuild.parentBuilds,
                parentBuildId: restartBuild.parentBuildId,
                startFrom: jobName
            });

            return restartEvent;
        };
        event.run = async () => {
            let build = null;

            // eslint-disable-next-line no-cond-assign
            while ((build = this.getRunningBuild(event.id)) !== null) {
                await build.complete('SUCCESS');
            }
        };
        event.getBuildOf = jobName => {
            return event.getBuilds().find(build => build.job.name === jobName) || null;
        };

        this.records.push(event);

        if (config.startFrom) {
            const { startFrom } = config;
            const startJobs = [];

            if (startFrom.startsWith('~sd@') || startFrom.startsWith('sd@')) {
                pipeline.workflowGraph.edges.forEach(edge => {
                    const { src, dest } = edge;

                    if (src === config.startFrom) {
                        startJobs.push(dest);
                    }
                });
            }

            if (pipeline.jobs[startFrom]) {
                startJobs.push(startFrom);
            }

            for (const jobName of startJobs) {
                const job = this.server.app.jobFactory.get({ name: jobName, pipelineId: pipeline.id });
                const build = await this.server.app.buildFactory.create({
                    jobId: job.id,
                    eventId: event.id,
                    ...config
                });

                build.start();
            }
        }

        return event;
    }

    /**
     * Mock method: Get event
     * @param {Object} config
     * @returns {Event}
     */
    get(config) {
        const id = config instanceof Object ? config.id : Number(config);

        return this.records[id] || null;
    }

    /**
     * Mock method: get events
     * @param {Object} config
     * @returns {Event[]}
     */
    async list({ params }) {
        const { parentEventId } = params;

        return this.getChildEvents(parentEventId);
    }

    /**
     * Test method: get one of running builds
     * @param {Number} eventId
     * @returns {Build}
     */
    getRunningBuild(eventId) {
        return (
            this.server.app.buildFactory.records.find(build => {
                return build && build.isStarted && build.status === 'RUNNING' && build.eventId === eventId;
            }) || null
        );
    }

    /**
     * Test method: get child events
     * @param {Number} parentEventId
     * @returns {Event[]}
     */
    getChildEvents(parentEventId) {
        return this.records.filter(event => event && event.parentEventId === parentEventId);
    }
}

class BuildFactoryMock {
    /**
     * @param {CustomServer} server
     */
    constructor(server) {
        this.server = server;
        this.records = [null];
        this.uniquePairs = {};
        this.removedRecords = [];
    }

    /**
     * Mock method: Create build
     * @param {Object} config
     * @returns {Build}
     */
    async create(config) {
        const uniqueKey = `event${config.eventId}:job${config.jobId}`;

        if (!this.uniquePairs[uniqueKey]) {
            this.uniquePairs[uniqueKey] = true;
        } else {
            assert.fail(`Unique error: ${uniqueKey}`);
        }

        const build = {
            isStarted: false,
            status: 'CREATED',
            ...config,
            id: this.records.length,
            update: sinon.stub(),
            toJson: sinon.stub(),
            toJsonWithSteps: sinon.stub()
        };

        build.update.returns(build);
        build.toJson.returns({ ...build });
        build.toJsonWithSteps.resolves({});
        build.start = () => {
            assert.isFalse(build.isStarted);
            build.isStarted = true;
            build.status = 'RUNNING';
        };
        build.remove = () => {
            this.removedRecords.push(build);
            this.uniquePairs[uniqueKey] = false;
            this.records[build.id] = null;
        };
        build.job = build.job || this.server.app.jobFactory.get(build.jobId);
        build.event = build.event || this.server.app.eventFactory.get(build.eventId);

        if (!Array.isArray(build.parentBuildId)) {
            build.parentBuildId = Array.from(new Set([build.parentBuildId || []].flat()));
        }

        const nextStageName = getStageFromSetupJobName(build.job.name);

        if (nextStageName) {
            const stage = await this.server.app.stageFactory.get({
                pipelineId: build.job.pipelineId,
                name: nextStageName
            });

            await this.server.app.stageBuildFactory.create({
                stageId: stage.id,
                eventId: build.event.id,
                status: 'CREATED'
            });
        }

        // Test method
        build.complete = async status => {
            const response = await this.server.inject({
                method: 'PUT',
                url: `/builds/${build.id}`,
                payload: { status },
                auth: {
                    credentials: {
                        username: build.id,
                        scmContext: 'github:github.com',
                        scope: ['build']
                    },
                    strategy: ['token']
                }
            });

            assert.equal(response.statusCode, 200);
        };

        this.records.push(build);

        if (config.start) {
            build.start();
        }

        return build;
    }

    /**
     * Mock method: get build
     * @param {Object} config
     * @returns {Build}
     */
    get(config) {
        if (Number.isInteger(config)) {
            return this.records[config] || null;
        }

        const { id, eventId, jobId } = config;

        if (id) {
            return this.records[id] || null;
        }

        return (
            this.records.find(build => {
                return build && build.eventId === eventId && build.jobId === jobId;
            }) || null
        );
    }

    /**
     * Mock method: get latest build
     * @param {Object} config
     * @returns {Build[]}
     */
    getLatestBuilds(config) {
        const builds = {};

        this.records.forEach(build => {
            if (build && parseInt(build.event.groupEventId, 10) === parseInt(config.groupEventId, 10)) {
                builds[build.job.id] = build;
            }
        });

        return Object.keys(builds).map(key => builds[key]);
    }

    /**
     * Test method: get running build
     * @param {void}
     * @returns {Build}
     */
    getRunningBuild() {
        return this.records.find(build => build && build.isStarted && build.status === 'RUNNING') || null;
    }

    /**
     * Test method: run all builds
     * @param {void}
     * @returns {Promise}
     */
    async run() {
        let build = null;

        // eslint-disable-next-line no-cond-assign
        while ((build = this.getRunningBuild())) {
            await build.complete('SUCCESS');
        }
    }
}

class StageBuildFactoryMock {
    /**
     * @param {CustomServer} server
     */
    constructor(server) {
        this.server = server;
        this.records = [null];
    }

    create(config) {
        const stageBuild = {
            ...config,
            id: this.records.length,
            update: sinon.stub()
        };

        stageBuild.update.returns(stageBuild);
        this.records.push(stageBuild);

        return stageBuild;
    }

    async get(config) {
        const { stageId, eventId } = config;

        return this.records.find(stageBuild => {
            return (
                stageBuild &&
                parseInt(stageBuild.stageId, 10) === parseInt(stageId, 10) &&
                parseInt(stageBuild.eventId, 10) === parseInt(eventId, 10)
            );
        });
    }
}

class StageFactoryMock {
    constructor(server) {
        this.server = server;
        this.records = [null];
    }

    create(config) {
        const stage = {
            ...config,
            id: this.records.length
        };

        this.records.push(stage);

        return stage;
    }

    async get(config) {
        const { pipelineId, name } = config;

        return (
            this.records.find(stage => {
                return stage && parseInt(stage.pipelineId, 10) === parseInt(pipelineId, 10) && stage.name === name;
            }) || null
        );
    }
}

class JobFactoryMock {
    /**
     * @param {CustomServer} server
     */
    constructor(server) {
        this.server = server;
        this.records = [null];
    }

    /**
     * Mock method: create job
     * @param {Object} config
     * @returns {Job}
     */
    create(config) {
        const job = {
            ...config,
            permutations: [{}],
            id: this.records.length,
            toJson: sinon.stub(),
            getLatestBuild: sinon.stub().resolves([]),
            state: 'ENABLED'
        };

        this.records.push(job);
        job.toJson.returns({ ...job });

        return job;
    }

    /**
     * Mock method: get job
     * @param {Object} config
     * @returns {Job}
     */
    get(config) {
        if (Number.isInteger(config)) {
            return this.records[config] || null;
        }

        const { id, name, pipelineId } = config;

        if (id) {
            return this.records[id] || null;
        }

        return (
            this.records.find(job => {
                return job && parseInt(job.pipelineId, 10) === parseInt(pipelineId, 10) && job.name === name;
            }) || null
        );
    }
}

class LockMock {
    constructor(delay) {
        this.locker = {};
        this.delay = delay || 0;
    }

    async lock(resource) {
        if (this.locker[resource]) {
            return null;
        }

        this.locker[resource] = true;

        return {
            unlock: async () =>
                setTimeout(() => {
                    this.locker[resource] = false;
                }, this.delay)
        };
    }

    async unlock(lock) {
        if (lock) {
            await lock.unlock();

            return 1;
        }

        return null;
    }
}

module.exports = {
    TriggerFactoryMock,
    PipelineFactoryMock,
    EventFactoryMock,
    BuildFactoryMock,
    StageBuildFactoryMock,
    StageFactoryMock,
    JobFactoryMock,
    LockMock
};
