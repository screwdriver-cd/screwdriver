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

    it('simple normal triggers', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('simple-normal-triggers.yaml');

        const event = eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'a',
        });

        await event.run();
        assert.equal(event.getBuildOf('k').status, 'SUCCESS');

        const restartEvent = event.restartFrom('b');
        await restartEvent.run();

        assert.equal(restartEvent.getBuildOf('k').status, 'SUCCESS');
    });

    it('simple normal triggers with failure', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('simple-normal-triggers.yaml');

        const event = eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'a',
        });

        await event.getBuildOf('a').complete('SUCCESS');
        await event.getBuildOf('b').complete('SUCCESS');
        await event.getBuildOf('c').complete('FAILURE');

        assert.isNull(event.getBuildOf('d'));
        assert.lengthOf(buildFactoryMock.removedRecords, 1);
    });

    it('trigger a external', async () => {
        const pipeline1 = await pipelineFactoryMock.createFromFile('external-parent.yaml');
        const pipeline2 = await pipelineFactoryMock.createFromFile('external-child1.yaml');
        const pipeline3 = await pipelineFactoryMock.createFromFile('external-child2.yaml');

        const event = eventFactoryMock.create({
            pipelineId: pipeline1.id,
            startFrom: 'parent1'
        });

        // run all builds
        await buildFactoryMock.run();

        // Remote join belongs to the event
        assert.equal(event.getBuildOf('parent2').status, 'SUCCESS');

        const restartEvent = event.restartFrom('parent1');

        // run all builds
        await buildFactoryMock.run();

        const [downEvent1, downEvent2] = eventFactoryMock.getChildEvents(restartEvent.id);
        const [upstreamEvent1] = eventFactoryMock.getChildEvents(downEvent1.id);
        const [upstreamEvent2] = eventFactoryMock.getChildEvents(downEvent2.id);

        const build1 = upstreamEvent1.getBuildOf('parent2');
        const build2 = upstreamEvent2.getBuildOf('parent2');

        // Remote join does not belong to the restart event
        assert.isNull(restartEvent.getBuildOf('parent2'));
        assert.isNotNull(upstreamEvent1);
        assert.isNotNull(upstreamEvent2);
        assert.deepEqual([build1.status, build2.status].sort(), ['SUCCESS', 'CREATED'].sort())
    });
});
