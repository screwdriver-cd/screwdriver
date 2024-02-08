'use strict';

const configParser = require('screwdriver-config-parser');
const fs = require('fs');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const rewiremock = require('rewiremock/node');
const { assert } = require('chai');

class TriggerFactoryMock {
    server;
    records = {};

    constructor(server) {
        this.server = server;
    }

    create({src, dest}) {
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

    create(config) {
        const pipeline = {
            ...config,
            id: this.records.length,
            toJson: sinon.stub(),
            admin: {
                unsealToken: sinon.stub().resolves('token'),
            },
        };

        this.records.push(pipeline);
        pipeline.toJson.returns({ ...pipeline });

        const { jobs, workflowGraph } = pipeline;

        Object.keys(jobs).forEach(name => {
            jobs[name] = this.server.app.jobFactory.create({
                name,
                pipeline,
                pipelineId: pipeline.id,
            });
        });

        workflowGraph.edges.forEach(edge => {
            const { src } = edge;
            const dest = `~sd@${pipeline.id}:${edge.dest}`;

            if (src.startsWith('~sd@') || src.startsWith('sd@')) {
                this.server.app.triggerFactory.create({ src, dest });
            }
        });

        return pipeline;
    }

    async createFromFile(fileName) {
        const yaml = fs.readFileSync(`${__dirname}/data/trigger/${fileName}`).toString();

        const pipeline = await configParser({ yaml });
        pipeline.yaml = yaml;

        return this.create(pipeline);
    }

    async setExternalTriggers() {
        for (let i = 1; i < this.records.length; i++) {
            const pipeline = this.records[i];

            const { workflowGraph } = await configParser({
                yaml: pipeline.yaml,
                triggerFactory: this.server.app.triggerFactory,
                pipelineId: pipeline.id,
            });

            workflowGraph.nodes.forEach(node => {
                let pipelineId = pipeline.id;
                let name = node.name;

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
    };

    get(config) {
        const id = config instanceof Object ? config.id : config

        return this.records[id];
    }
}

class EventFactoryMock {
    server;
    records = [null];
    scm = {
        getCommitSha: sinon.stub().resolves('github:github.com'),
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
            toJson: sinon.stub(),
        };

        const pipeline = this.server.app.pipelineFactory.get(event.pipelineId);
        event.workflowGraph = pipeline.workflowGraph;
        event.getBuilds = () => {
            return this.server.app.buildFactory.records.filter(build => {
                return build && build.eventId == event.id;
            });
        }

        event.update.returns(event);
        event.toJson.returns({ ...event });

        this.records.push(event);

        if (config.startFrom) {
            const startJobs = [];

            pipeline.workflowGraph.edges.forEach(edge => {
                const { src, dest } = edge;

                if (src === config.startFrom) {
                    startJobs.push(dest);
                }
            });

            startJobs.forEach(name => {
                const job = this.server.app.jobFactory.get({ name, pipelineId: pipeline.id });
                const build = this.server.app.buildFactory.create({
                    jobId: job.id,
                    eventId: event.id,
                    ...config,
                });

                build.start();
            });
        }

        return event;
    }

    get(config) {
        const id = config instanceof Object ? config.id : config

        return this.records[id];
    }

    async list({ parentEventId }) {
        return this.records.filter(event => event && event.parentEventId === parentEventId);
    }
}

class BuildFactoryMock {
    server;
    records = [null];

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
            toJsonWithSteps: sinon.stub(),
        };

        build.update.returns(build);
        build.toJson.returns({ ...build });
        build.toJsonWithSteps.resolves({});
        build.start = () => {
            build.isStarted = true;
            build.status = 'RUNNING';
        };
        build.job = build.job || this.server.app.jobFactory.get(build.jobId);
        build.event = build.event || this.server.app.eventFactory.get(build.eventId);

        this.records.push(build);

        if (config.start) {
            build.start();
        }

        return build;
    }

    createRunningBuild(config) {
        return this.create({
            ...config,
            status: 'RUNNING',
            isStarted: true
        });
    }

    get(config) {
        if (config instanceof Object) {
            const { id, eventId, jobId } = config;

            if (eventId) {
                return this.records.find(build => {
                    return build && build.eventId === eventId && build.jobId === jobId;
                }) || null;
            }

            return this.records[id];
        }

        return this.records[config];
    }

    getLatestBuilds(config) {
        const builds = {};

        this.records.forEach(build => {
            if (build && build.event.groupEventId == config.groupEventId) {
                builds[build.job.name] = build;
            }
        });

        return Object.keys(builds).map(key => builds[key]);
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
            state: 'ENABLED',
        };

        this.records.push(job);
        job.toJson.returns({ ...job });

        return job;
    }

    get(config) {
        if (config instanceof Object) {
            const { id, name, pipelineId } = config;

            if (name) {
                return this.records.find(job => {
                    return job && job.pipelineId == pipelineId && job.name == name;
                });
            }

            return this.records[id] || null;
        }

        return this.records[config] || null;
    }
}

class LockMock {
    constructor() {
        this.lock = sinon.stub();
        this.unlock = sinon.stub();
    }
}

describe('trigger test', () => {
    const scmContext = 'github:github.com';

    let buildFactoryMock = new BuildFactoryMock();
    let pipelineFactoryMock = new PipelineFactoryMock();
    let eventFactoryMock = new EventFactoryMock();
    let jobFactoryMock = new JobFactoryMock();
    let triggerFactory = new TriggerFactoryMock();
    let server = new hapi.Server();

    const lockMock = new LockMock();
    const logBaseUrl = 'https://store.screwdriver.cd';

    const bannerFactoryMock = {
        scm: {
            getDisplayName: sinon.stub()
        }
    };

    const loggerMock = {
        info: sinon.stub(),
        error: sinon.stub(),
        warn: sinon.stub(),
    };

    beforeEach(async () => {
        const plugin = rewiremock.proxy('../../plugins/builds', {
            '../../plugins/lock': lockMock,
            'screwdriver-logger': loggerMock,
        });

        server = new hapi.Server({
            port: 12345,
            host: 'localhost',
        });

        buildFactoryMock = new BuildFactoryMock(server);
        pipelineFactoryMock = new PipelineFactoryMock(server);
        eventFactoryMock = new EventFactoryMock(server);
        jobFactoryMock = new JobFactoryMock(server);
        triggerFactory = new TriggerFactoryMock(server);

        server.app = {
            buildFactory: buildFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            eventFactory: eventFactoryMock,
            jobFactory: jobFactoryMock,
            bannerFactory: bannerFactoryMock,
            triggerFactory: triggerFactory,
        };

        server.auth.scheme('custom', () => ({
            authenticate: (_, h) =>
                h.authenticated({
                    credentials: {
                        scope: ['build']
                    }
                })
        }));
        server.auth.strategy('token', 'custom');
        server.auth.strategy('session', 'custom');
        server.event('build_status');

        await server.register([
            {
                plugin,
                options: {
                    ecosystem: {
                        store: logBaseUrl
                    },
                    authConfig: {
                        jwtPrivateKey: 'boo'
                    },
                    externalJoin: true,
                    admins: ['github:batman']
                }
            },
        ]);
    });

    afterEach(() => {
        server.stop();
        server = null;
        rewiremock.clear();
    });

    it('trigger a single join', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('single-join.yaml');
        await pipelineFactoryMock.setExternalTriggers();

        const event = eventFactoryMock.create({
            pipelineId: pipeline.id,
        });

        buildFactoryMock.createRunningBuild({
            eventId: event.id,
            job: pipeline.jobs['first'],
            jobId: pipeline.jobs['first'].id,
        });

        const builds = buildFactoryMock.records;

        while(builds.some(build => {
            return build && build.isStarted && build.status === 'RUNNING';
        })) {
            const build = builds.find(build => build && build.isStarted && build.status === 'RUNNING');

            const options = {
                method: 'PUT',
                url: `/builds/${build.id}`,
                payload: {
                    status: 'SUCCESS'
                },
                auth: {
                    credentials: {
                        username: build.id,
                        scmContext,
                        scope: ['build']
                    },
                    strategy: ['token']
                }
            };

            const response = await server.inject(options);
        }

        // console.log(builds);

        const build2 = builds[2];
        assert.equal(build2.status, 'SUCCESS');
    });

    it('trigger a external', async () => {
        const pipeline1 = await pipelineFactoryMock.createFromFile('external-parent.yaml');
        const pipeline2 = await pipelineFactoryMock.createFromFile('external-child1.yaml');
        const pipeline3 = await pipelineFactoryMock.createFromFile('external-child2.yaml');
        await pipelineFactoryMock.setExternalTriggers();

        const event1 = eventFactoryMock.create({
            pipelineId: pipeline1.id,
        });
        buildFactoryMock.createRunningBuild({
            eventId: event1.id,
            pipelineId: pipeline1.id,
            job: pipeline1.jobs['parent1'],
            jobId: pipeline1.jobs['parent1'].id,
        });

        const builds = buildFactoryMock.records;

        while(builds.some(build => {
            return build && build.isStarted && build.status === 'RUNNING';
        })) {
            const build = builds.find(build => build && build.isStarted && build.status === 'RUNNING');

            const options = {
                method: 'PUT',
                url: `/builds/${build.id}`,
                payload: {
                    status: 'SUCCESS'
                },
                auth: {
                    credentials: {
                        username: build.id,
                        scmContext,
                        scope: ['build']
                    },
                    strategy: ['token']
                }
            };

            const response = await server.inject(options);
        }

        const restartEvent = eventFactoryMock.create({
            pipelineId: pipeline1.id,
            parentEventId: event1.id,
        });
        buildFactoryMock.createRunningBuild({
            eventId: restartEvent.id,
            pipelineId: pipeline1.id,
            job: pipeline1.jobs['parent1'],
            jobId: pipeline1.jobs['parent1'].id,
        });

        while(builds.some(build => {
            return build && build.isStarted && build.status === 'RUNNING';
        })) {
            const build = builds.find(build => build && build.isStarted && build.status === 'RUNNING');

            const options = {
                method: 'PUT',
                url: `/builds/${build.id}`,
                payload: {
                    status: 'SUCCESS'
                },
                auth: {
                    credentials: {
                        username: build.id,
                        scmContext,
                        scope: ['build']
                    },
                    strategy: ['token']
                }
            };

            const response = await server.inject(options);
        }

        console.log(builds.filter(build => build !== null).map(build => {
            const { job, event, status, isStarted } = build;
            return `${job.name} - ${status}:${isStarted} - e:${event.id} - ${event.groupEventId}`
        }));

        const build2 = builds[2];
        // assert.equal(build2.status, 'SUCCESS');
    });
});
