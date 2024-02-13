'use strict';

/* eslint max-classes-per-file: off */
/* eslint-disable */

const configParser = require('screwdriver-config-parser');
const fs = require('fs');
const sinon = require('sinon');
const { assert } = require('chai');

class TriggerFactoryMock {
    server;

    records = {};

    constructor(server) {
        this.server = server;
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
    server;

    records = [null];

    constructor(server) {
        this.server = server;
    }

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

        const { jobs, workflowGraph } = pipeline;

        Object.keys(jobs).forEach(name => {
            jobs[name] = this.server.app.jobFactory.create({
                name,
                pipeline,
                pipelineId: pipeline.id
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
                return event && event.pipelineId == pipeline.id;
            });

            return events ? events.slice(-1)[0] : null;
        };

        this.records.push(pipeline);

        await this.syncTriggers();

        return pipeline;
    }

    get(id) {
        return this.records[Number(id)];
    }

    // custom methods
    async createFromFile(fileName) {
        const yaml = fs.readFileSync(`${__dirname}/data/trigger/${fileName}`).toString();

        const pipeline = await configParser({ yaml });

        pipeline.yaml = yaml;

        return this.create(pipeline);
    }

    async syncTriggers() {
        for (let i = 1; i < this.records.length; i++) {
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
    server;

    records = [null];

    scm = {
        getCommitSha: sinon.stub().resolves('github:github.com')
    };

    constructor(server) {
        this.server = server;
    }

    create(config) {
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
                return build && build.eventId == event.id;
            });
        };
        event.update.returns(event);
        event.toJson.returns({ ...event });

        // Custom methods
        event.restartFrom = jobName => {
            const restartBuild = event.getBuildOf(jobName);

            const restartEvent = this.create({
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

            while ((build = this.getRunningBuild(event.id))) {
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

            startJobs.forEach(name => {
                const job = this.server.app.jobFactory.get({ name, pipelineId: pipeline.id });
                const build = this.server.app.buildFactory.create({
                    jobId: job.id,
                    eventId: event.id,
                    ...config
                });

                build.start();
            });
        }

        return event;
    }

    get(config) {
        const id = config instanceof Object ? config.id : Number(config);

        return this.records[id] || null;
    }

    async list({ params }) {
        const { parentEventId } = params;

        return this.getChildEvents(parentEventId);
    }

    getRunningBuild(eventId) {
        return (
            this.server.app.buildFactory.records.find(build => {
                return build && build.isStarted && build.status === 'RUNNING' && build.eventId === eventId;
            }) || null
        );
    }

    getChildEvents(parentEventId) {
        return this.records.filter(event => event && event.parentEventId === parentEventId);
    }
}

class BuildFactoryMock {
    server;

    records = [null];

    uniquePairs = {};

    removedRecords = [];

    constructor(server) {
        this.server = server;
    }

    create(config) {
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
            this.records[build.id] = null;
        };
        build.job = build.job || this.server.app.jobFactory.get(build.jobId);
        build.event = build.event || this.server.app.eventFactory.get(build.eventId);

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

        const eventJobKey = `event${build.event.id}:job${build.job.id}`;

        if (!this.uniquePairs[eventJobKey]) {
            this.uniquePairs[eventJobKey] = true;
        } else {
            assert.fail(`Unique error: ${eventJobKey}`);
        }

        this.records.push(build);

        if (config.start) {
            build.start();
        }

        return build;
    }

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

    getLatestBuilds(config) {
        const builds = {};

        this.records.forEach(build => {
            if (build && build.event.groupEventId == config.groupEventId) {
                builds[build.job.id] = build;
            }
        });

        return Object.keys(builds).map(key => builds[key]);
    }

    getRunningBuild() {
        return this.records.find(build => build && build.isStarted && build.status === 'RUNNING') || null;
    }

    async run() {
        let build = null;

        while ((build = this.getRunningBuild())) {
            await build.complete('SUCCESS');
        }
    }
}

class JobFactoryMock {
    server;

    records = [null];

    constructor(server) {
        this.server = server;
    }

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
                return job && job.pipelineId == pipelineId && job.name == name;
            }) || null
        );
    }
}

class LockMock {
    locker = {};

    delay = 0;

    constructor(delay) {
        if (delay) {
            this.delay = delay;
        }
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

    async unlock(lock, _) {
        if (lock) {
            await lock.unlock();

            return 1;
        }

        return null;
    }
}

/* eslint-disable */

module.exports = {
    TriggerFactoryMock,
    PipelineFactoryMock,
    EventFactoryMock,
    BuildFactoryMock,
    JobFactoryMock,
    LockMock
};
