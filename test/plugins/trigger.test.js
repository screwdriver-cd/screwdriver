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
    LockMock
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
        warn: sinon.stub()
    };

    beforeEach(async () => {
        const plugin = rewiremock.proxy('../../plugins/builds', {
            '../../plugins/lock': lockMock,
            'screwdriver-logger': loggerMock
        });

        server = new hapi.Server({
            port: 12345,
            host: 'localhost'
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
            triggerFactory
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
                        store: 'https://store.screwdriver.cd'
                    },
                    authConfig: {
                        jwtPrivateKey: 'boo'
                    },
                    externalJoin: true,
                    admins: ['github:batman']
                }
            }
        ]);
    });

    afterEach(() => {
        server = null;
    });

    it('[ ~a ] is triggered', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a.yaml');

        const event = eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');

        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');

        assert.equal(event.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ ~a, ~b ] is triggered by a once', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_~b.yaml');

        const event = eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'SUCCESS');

        await event.getBuildOf('b').complete('SUCCESS');
        assert.equal(eventFactoryMock.getRunningBuild(event.id), null);
    });

    it('[ ~a, b, c ] is triggered by a once', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_b_c.yaml');

        const event = eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'SUCCESS');

        await event.getBuildOf('b').complete('SUCCESS');
        await event.getBuildOf('c').complete('SUCCESS');
        assert.equal(eventFactoryMock.getRunningBuild(event.id), null);
    });

    it('[ a ] is triggered', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a.yaml');

        const event = eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ a, b ] is triggered', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a_b.yaml');

        const event = eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'CREATED');

        await event.getBuildOf('b').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ a, b ] is not triggered when b was failed', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a_b.yaml');

        const event = eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');

        const build = event.getBuildOf('target');

        await event.getBuildOf('b').complete('FAILURE');
        assert.equal(build.status, 'CREATED');
        assert.isNull(event.getBuildOf('target'));
    });

    it('[ ~sd@1:a ] is triggered in a downstream', async () => {
        const parentPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a-parent.yaml');
        const childPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a-child.yaml');

        const parentEvent = eventFactoryMock.create({
            pipelineId: parentPipeline.id,
            startFrom: 'hub'
        });

        await parentEvent.getBuildOf('hub').complete('SUCCESS');
        await parentEvent.getBuildOf('a').complete('SUCCESS');

        const childEvent = childPipeline.getLatestEvent();

        assert.equal(childEvent.getBuildOf('target').status, 'RUNNING');

        await childEvent.getBuildOf('target').complete('SUCCESS');
        assert.equal(childEvent.getBuildOf('target').status, 'SUCCESS');
    });

    xit('[ sd@1:a ] is triggered in a downstream', async () => {
        const parentPipeline = await pipelineFactoryMock.createFromFile('sd@1:a-parent.yaml');
        const childPipeline = await pipelineFactoryMock.createFromFile('sd@1:a-child.yaml');

        const parentEvent = eventFactoryMock.create({
            pipelineId: parentPipeline.id,
            startFrom: 'hub'
        });

        await parentEvent.getBuildOf('hub').complete('SUCCESS');
        await parentEvent.getBuildOf('a').complete('SUCCESS');

        const childEvent = childPipeline.getLatestEvent();

        assert.equal(childEvent.getBuildOf('target').status, 'RUNNING');

        await childEvent.getBuildOf('target').complete('SUCCESS');
        assert.equal(childEvent.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ ~sd@1:a ] is triggered in multiple downstream', async () => {
        const parentPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a-parent.yaml');
        const childPipeline1 = await pipelineFactoryMock.createFromFile('~sd@1:a-child.yaml');
        const childPipeline2 = await pipelineFactoryMock.createFromFile('~sd@1:a-child.yaml');

        eventFactoryMock.create({
            pipelineId: parentPipeline.id,
            startFrom: 'hub'
        });

        // run all builds
        await buildFactoryMock.run();

        const childEvent1 = childPipeline1.getLatestEvent();
        const childEvent2 = childPipeline2.getLatestEvent();

        assert.equal(childEvent1.getBuildOf('target').status, 'SUCCESS');
        assert.equal(childEvent2.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ ~sd@2:a ] is triggered in a upstream', async () => {
        const parentPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a-parent.yaml');

        await pipelineFactoryMock.createFromFile('~sd@2:a-child.yaml');

        const event = eventFactoryMock.create({
            pipelineId: parentPipeline.id,
            startFrom: 'hub'
        });

        // run all builds
        await buildFactoryMock.run();

        assert.equal(event.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ sd@2:a ] is triggered in a upstream', async () => {
        const parentPipeline = await pipelineFactoryMock.createFromFile('sd@2:a-parent.yaml');

        await pipelineFactoryMock.createFromFile('sd@2:a-child.yaml');

        const event = eventFactoryMock.create({
            pipelineId: parentPipeline.id,
            startFrom: 'hub'
        });

        // run all builds
        await buildFactoryMock.run();

        assert.equal(event.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ sd@2:a, sd@3:a ] is triggered in a upstream', async () => {
        const parentPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-parent.yaml');

        await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-child.yaml');
        await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-child.yaml');

        const event = eventFactoryMock.create({
            pipelineId: parentPipeline.id,
            startFrom: 'hub'
        });

        // run all builds
        await buildFactoryMock.run();

        assert.equal(event.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ sd@2:a, sd@2:b, sd@2:c ] is triggered in a upstream', async () => {
        const parentPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@2:b_sd@2:c-parent.yaml');

        await pipelineFactoryMock.createFromFile('sd@2:a_sd@2:b_sd@2:c-child.yaml');

        const event = eventFactoryMock.create({
            pipelineId: parentPipeline.id,
            startFrom: 'hub'
        });

        // run all builds
        await buildFactoryMock.run();

        assert.equal(event.getBuildOf('target').status, 'SUCCESS');
    });
});
