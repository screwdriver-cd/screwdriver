'use strict';

const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const rewiremock = require('rewiremock/node');
const { assert } = require('chai');
const {
    TriggerFactoryMock,
    PipelineFactoryMock,
    EventFactoryMock,
    BuildFactoryMock,
    JobFactoryMock,
    LockMock,
} = require('./trigger.test.helper');

describe('trigger test', () => {
    let server = new hapi.Server();
    let buildFactoryMock = new BuildFactoryMock();
    let pipelineFactoryMock = new PipelineFactoryMock();
    let eventFactoryMock = new EventFactoryMock();
    let jobFactoryMock = new JobFactoryMock();
    let triggerFactory = new TriggerFactoryMock();
    const lockMock = new LockMock();

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
                        store: 'https://store.screwdriver.cd',
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

    it('[ ~a ], [ ~b, ~c ], [ d ] is triggered', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('internal-simple.yaml');

        const event = eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'a',
        });

        await event.getBuildOf('a').complete('SUCCESS');

        assert.equal(event.getBuildOf('b').status, 'RUNNING');
        assert.equal(event.getBuildOf('c').status, 'RUNNING');

        await event.getBuildOf('b').complete('SUCCESS');
        await event.getBuildOf('c').complete('SUCCESS');

        assert.equal(event.getBuildOf('d').status, 'RUNNING');
        assert.equal(pipeline.getBuildsOf('d').length, 1);

        await event.getBuildOf('d').complete('SUCCESS');

        assert.equal(event.getBuildOf('e').status, 'RUNNING');
    });

    it('[ ~b, ~c ], [ b, ~c ], [ ~b, c ] is triggered when b was failed', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('internal-two.yaml');

        const event = eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'a',
        });

        await event.getBuildOf('a').complete('SUCCESS');
        await event.getBuildOf('b').complete('FAILURE');
        await event.getBuildOf('c').complete('SUCCESS');

        assert.equal(event.getBuildOf('d').status, 'RUNNING');
        assert.equal(event.getBuildOf('e').status, 'RUNNING');
        assert.equal(event.getBuildOf('f').status, 'RUNNING');
        assert.equal(pipeline.getBuildsOf('d').length, 1);
        assert.equal(pipeline.getBuildsOf('e').length, 1);
        assert.equal(pipeline.getBuildsOf('f').length, 1);
    });

    it('[ b, c, d ], [ b, c, ~d ], [ b, ~c, ~d ] is triggered', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('internal-three.yaml');

        const event = eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'a',
        });

        await event.getBuildOf('a').complete('SUCCESS');
        await event.getBuildOf('b').complete('SUCCESS');
        await event.getBuildOf('c').complete('SUCCESS');
        await event.getBuildOf('d').complete('SUCCESS');

        assert.equal(event.getBuildOf('e').status, 'RUNNING');
        assert.equal(event.getBuildOf('f').status, 'RUNNING');
        assert.equal(event.getBuildOf('g').status, 'RUNNING');
        assert.equal(pipeline.getBuildsOf('e').length, 1);
        assert.equal(pipeline.getBuildsOf('f').length, 1);
        assert.equal(pipeline.getBuildsOf('g').length, 1);
    });

    it('[ ~sd@1:a ], [ sd@2:a, sd@3:a ], [ sd@2:b, sd@3:b ] is triggered', async () => {
        const pipeline1 = await pipelineFactoryMock.createFromFile('external-twice-parent.yaml');
        const pipeline2 = await pipelineFactoryMock.createFromFile('external-twice-child1.yaml');
        const pipeline3 = await pipelineFactoryMock.createFromFile('external-twice-child2.yaml');

        const event = eventFactoryMock.create({
            pipelineId: pipeline1.id,
            startFrom: 'a'
        });

        // run all builds
        await buildFactoryMock.run();

        // downstream builds
        assert.equal(pipeline2.getBuildsOf('a')[0].status, 'SUCCESS')
        assert.equal(pipeline3.getBuildsOf('a')[0].status, 'SUCCESS')
        assert.equal(pipeline2.getBuildsOf('a').length, 1)
        assert.equal(pipeline3.getBuildsOf('a').length, 1)

        // Remote join belong to the upstream event
        assert.equal(event.getBuildOf('b').status, 'SUCCESS');
        assert.equal(event.getBuildOf('c').status, 'SUCCESS');
    });

    it('[ sd@2:a, sd@3:a ] is triggered in restart case', async () => {
        const pipeline1 = await pipelineFactoryMock.createFromFile('external-parent.yaml');
        await pipelineFactoryMock.createFromFile('external-child1.yaml');
        await pipelineFactoryMock.createFromFile('external-child2.yaml');

        const event = eventFactoryMock.create({
            pipelineId: pipeline1.id,
            startFrom: 'a'
        });

        // run all builds
        await buildFactoryMock.run();

        // Remote join belongs to the event
        assert.equal(event.getBuildOf('b').status, 'SUCCESS');

        const restartEvent = event.restartFrom('a');

        // run all builds
        await buildFactoryMock.run();

        const [downEvent1, downEvent2] = eventFactoryMock.getChildEvents(restartEvent.id);
        const [upstreamEvent1] = eventFactoryMock.getChildEvents(downEvent1.id);
        const [upstreamEvent2] = eventFactoryMock.getChildEvents(downEvent2.id);

        const build1 = upstreamEvent1.getBuildOf('b');
        const build2 = upstreamEvent2.getBuildOf('b');

        // Remote join does not belong to the restart event
        assert.isNull(restartEvent.getBuildOf('b'));
        assert.isNotNull(upstreamEvent1);
        assert.isNotNull(upstreamEvent2);
        assert.deepEqual([build1.status, build2.status].sort(), ['SUCCESS', 'CREATED'].sort())
    });
});
