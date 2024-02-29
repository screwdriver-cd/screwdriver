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
    StageBuildFactoryMock,
    StageFactoryMock,
    JobFactoryMock,
    LockMock
} = require('./trigger.test.helper');

describe('trigger tests', () => {
    let server = new hapi.Server();
    let buildFactoryMock = new BuildFactoryMock();
    let pipelineFactoryMock = new PipelineFactoryMock();
    let eventFactoryMock = new EventFactoryMock();
    let stageBuildFactoryMock = new StageBuildFactoryMock();
    let stageFactoryMock = new StageFactoryMock();
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
        stageBuildFactoryMock = new StageBuildFactoryMock(server);
        stageFactoryMock = new StageFactoryMock(server);
        jobFactoryMock = new JobFactoryMock(server);
        triggerFactory = new TriggerFactoryMock(server);

        server.app = {
            buildFactory: buildFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            eventFactory: eventFactoryMock,
            stageBuildFactory: stageBuildFactoryMock,
            stageFactory: stageFactoryMock,
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

    it('[ ~a ] is triggered when a succeeds', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');

        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');

        assert.equal(event.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ ~a ] is triggered and is triggered again when a restarts', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');
        await event.getBuildOf('target').complete('SUCCESS');

        const restartEvent = await event.restartFrom('a');

        await restartEvent.getBuildOf('a').complete('SUCCESS');

        assert.equal(restartEvent.getBuildOf('target').status, 'RUNNING');

        await restartEvent.getBuildOf('target').complete('SUCCESS');

        assert.equal(restartEvent.getBuildOf('target').status, 'SUCCESS');
    });

    it('Multiple [ ~a ] are triggered', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a-multiple.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');

        assert.equal(event.getBuildOf('target1').status, 'RUNNING');
        assert.equal(event.getBuildOf('target2').status, 'RUNNING');

        await event.getBuildOf('target1').complete('SUCCESS');
        await event.getBuildOf('target2').complete('SUCCESS');

        assert.equal(event.getBuildOf('target1').status, 'SUCCESS');
        assert.equal(event.getBuildOf('target2').status, 'SUCCESS');
    });

    it('[ ~a ] is not triggered when a fails', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('FAILURE');
        assert.isNull(event.getBuildOf('target'));
    });
    it('[ ~a ] is not triggered when a restarts and fails', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');

        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');

        assert.equal(event.getBuildOf('target').status, 'SUCCESS');

        const restartEvent = await event.restartFrom('a');

        await restartEvent.getBuildOf('a').complete('FAILURE');

        assert.isNull(restartEvent.getBuildOf('target'));
    });

    it('[ ~a ] is triggered when a fails once and then restarts and succeeds', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('FAILURE');

        assert.isNull(event.getBuildOf('target'));

        const restartEvent = await event.restartFrom('a');

        await restartEvent.getBuildOf('a').complete('SUCCESS');

        assert.equal(restartEvent.getBuildOf('target').status, 'RUNNING');

        await restartEvent.getBuildOf('target').complete('SUCCESS');

        assert.equal(restartEvent.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ a ] is triggered', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');

        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');

        assert.equal(event.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ a ] is triggered and is triggered again when a restarts', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');

        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');

        assert.equal(event.getBuildOf('target').status, 'SUCCESS');

        const restartEvent = await event.restartFrom('a');

        await restartEvent.getBuildOf('a').complete('SUCCESS');

        assert.equal(restartEvent.getBuildOf('target').status, 'RUNNING');

        await restartEvent.getBuildOf('target').complete('SUCCESS');

        assert.equal(restartEvent.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ a ] is not triggered when a fails', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('FAILURE');
        assert.isNull(event.getBuildOf('target'));
    });

    it('[ a ] is not triggered when a restarts and fails', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');

        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');

        assert.equal(event.getBuildOf('target').status, 'SUCCESS');

        const restartEvent = await event.restartFrom('a');

        await restartEvent.getBuildOf('a').complete('FAILURE');

        assert.isNull(restartEvent.getBuildOf('target'));
    });

    it('Multiple [ a ] are triggered', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a-multiple.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');

        assert.equal(event.getBuildOf('target1').status, 'RUNNING');
        assert.equal(event.getBuildOf('target2').status, 'RUNNING');

        await event.getBuildOf('target1').complete('SUCCESS');
        await event.getBuildOf('target2').complete('SUCCESS');

        assert.equal(event.getBuildOf('target1').status, 'SUCCESS');
        assert.equal(event.getBuildOf('target2').status, 'SUCCESS');
    });

    it('[ a ] is triggered when a fails once and then restarts and succeeds', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('FAILURE');

        assert.isNull(event.getBuildOf('target'));

        const restartEvent = await event.restartFrom('a');

        await restartEvent.getBuildOf('a').complete('SUCCESS');

        assert.equal(restartEvent.getBuildOf('target').status, 'RUNNING');

        await restartEvent.getBuildOf('target').complete('SUCCESS');

        assert.equal(restartEvent.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ ~a, ~b ] is triggered', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_~b.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');
        await event.getBuildOf('b').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'SUCCESS');

        assert.equal(pipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~a, ~b ] is triggered by a once', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_~b.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ ~a, ~b ] is triggered and is triggered again when a restarts', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_~b.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'SUCCESS');

        const restartEvent = await event.restartFrom('a');

        await restartEvent.getBuildOf('a').complete('SUCCESS');
        assert.equal(restartEvent.getBuildOf('target').status, 'RUNNING');

        await restartEvent.getBuildOf('target').complete('SUCCESS');
        assert.equal(restartEvent.getBuildOf('target').status, 'SUCCESS');

        assert.equal(eventFactoryMock.getRunningBuild(restartEvent.id), null);
    });

    it('[ ~a, ~b ] is triggered when a fails', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_~b.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('FAILURE');
        await event.getBuildOf('b').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'SUCCESS');

        assert.equal(eventFactoryMock.getRunningBuild(event.id), null);
    });

    it('[ ~a, b ] is triggered', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_b.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');
        await event.getBuildOf('b').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'SUCCESS');

        assert.equal(pipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~a, b ] is triggered when b succeeds', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_b.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('b').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ ~a, b ] is triggered when a fails once and then restarts and succeeds', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_b.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('FAILURE');

        const restartEvent = await event.restartFrom('a');

        await restartEvent.getBuildOf('a').complete('SUCCESS');
        assert.equal(restartEvent.getBuildOf('target').status, 'RUNNING');

        await restartEvent.getBuildOf('target').complete('SUCCESS');
        assert.equal(restartEvent.getBuildOf('target').status, 'SUCCESS');
        assert.equal(eventFactoryMock.getRunningBuild(restartEvent.id), null);
    });

    it('[ ~a, b ] is triggered when b fails once and then restarts and succeeds', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_b.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('b').complete('FAILURE');

        const restartEvent = await event.restartFrom('b');

        await restartEvent.getBuildOf('b').complete('SUCCESS');
        assert.equal(restartEvent.getBuildOf('target').status, 'RUNNING');

        await restartEvent.getBuildOf('target').complete('SUCCESS');
        assert.equal(restartEvent.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ ~a, b ] is triggered when a fails and b succeeds', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_b.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('FAILURE');
        await event.getBuildOf('b').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'SUCCESS');
        assert.equal(pipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~a, b ] is triggered when b fails and a succeeds', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_b.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('b').complete('FAILURE');
        await event.getBuildOf('a').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'SUCCESS');
        assert.equal(pipeline.getBuildsOf('target').length, 1);
    });

    it('[ a, b ] is triggered', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a_b.yaml');

        const event = await eventFactoryMock.create({
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
        assert.equal(pipeline.getBuildsOf('target').length, 1);
    });

    it('[ a, b ] is triggered when a restarts', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a_b.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');
        await event.getBuildOf('b').complete('SUCCESS');

        const restartEvent = await event.restartFrom('a');

        await restartEvent.getBuildOf('a').complete('SUCCESS');
        assert.equal(restartEvent.getBuildOf('target').status, 'RUNNING');

        await restartEvent.getBuildOf('target').complete('SUCCESS');
        assert.equal(restartEvent.getBuildOf('target').status, 'SUCCESS');

        assert.equal(pipeline.getBuildsOf('target').length, 2);
    });

    it('[ a, b ] is not triggered if only a succeeds', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a_b.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'CREATED');
    });

    it('[ a, b ] is triggered when b fails once and then restarts and succeeds', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a_b.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');

        const build = event.getBuildOf('target');

        await event.getBuildOf('b').complete('FAILURE');
        assert.equal(build.status, 'CREATED');
        assert.isNull(event.getBuildOf('target'));

        const restartEvent = await event.restartFrom('b');

        await restartEvent.getBuildOf('b').complete('SUCCESS');
        assert.equal(restartEvent.getBuildOf('target').status, 'RUNNING');

        await restartEvent.getBuildOf('target').complete('SUCCESS');
        assert.equal(restartEvent.getBuildOf('target').status, 'SUCCESS');
        assert.equal(eventFactoryMock.getRunningBuild(restartEvent.id), null);
    });

    it('[ a, b ] is not triggered when b was failed', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a_b.yaml');

        const event = await eventFactoryMock.create({
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

    it('[ a, b ] is not triggered when a was failed and b succeeds', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a_b.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('FAILURE');
        assert.isNull(event.getBuildOf('target'));

        await event.getBuildOf('b').complete('SUCCESS');
        assert.isNull(event.getBuildOf('target'));
    });

    it('[ a, b ] is not triggered when a was failed and b restarted and succeeds', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a_b.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('FAILURE');
        assert.isNull(event.getBuildOf('target'));

        await event.getBuildOf('b').complete('SUCCESS');
        assert.isNull(event.getBuildOf('target'));

        const restartEvent = await event.restartFrom('b');

        await restartEvent.getBuildOf('b').complete('SUCCESS');
        assert.isNull(restartEvent.getBuildOf('target'));
    });

    it('[ ~a, b, c ] is triggered by a once', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_b_c.yaml');

        const event = await eventFactoryMock.create({
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

        assert.equal(pipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~a, b, c ] is triggered when a succeeds', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_b_c.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ ~a, b, c ] is triggered when b and a, c succeed', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_b_c.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('b').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'CREATED');

        await event.getBuildOf('a').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'SUCCESS');

        await event.getBuildOf('c').complete('SUCCESS');
        assert.equal(pipeline.getBuildsOf('target').length, 1);
    });
    it('[ ~a, b, c ] is triggered when a fails and b and c succeed', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_b_c.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('FAILURE');
        assert.isNull(event.getBuildOf('target'));

        await event.getBuildOf('b').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'CREATED');

        await event.getBuildOf('c').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'SUCCESS');
        assert.equal(pipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~a, b, c ] is triggered when b and a, c succeed', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_b_c.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('b').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'CREATED');

        await event.getBuildOf('a').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'SUCCESS');

        await event.getBuildOf('c').complete('SUCCESS');
        assert.equal(pipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~a, b, c ] is triggered when a fails and b and c succeed', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_b_c.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('FAILURE');
        assert.isNull(event.getBuildOf('target'));

        await event.getBuildOf('b').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'CREATED');

        await event.getBuildOf('c').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'RUNNING');

        await event.getBuildOf('target').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'SUCCESS');
        assert.equal(eventFactoryMock.getRunningBuild(event.id), null);
    });

    it('[ ~a, b, c ] is not triggered when a and c fail but b succeeds', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_b_c.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('FAILURE');
        assert.isNull(event.getBuildOf('target'));

        await event.getBuildOf('b').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'CREATED');

        await event.getBuildOf('c').complete('FAILURE');
        assert.isNull(event.getBuildOf('target'));
        assert.equal(eventFactoryMock.getRunningBuild(event.id), null);
    });

    it('[ ~a, b, c ] is triggered when a and c fails, b succeeds, and then c restarts and succeeds', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_b_c.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('FAILURE');
        assert.isNull(event.getBuildOf('target'));

        await event.getBuildOf('b').complete('SUCCESS');
        assert.equal(event.getBuildOf('target').status, 'CREATED');

        await event.getBuildOf('c').complete('FAILURE');
        assert.isNull(event.getBuildOf('target'));

        const restartEvent = await event.restartFrom('c');

        await restartEvent.getBuildOf('c').complete('SUCCESS');
        assert.equal(restartEvent.getBuildOf('target').status, 'RUNNING');

        await restartEvent.getBuildOf('target').complete('SUCCESS');
        assert.equal(restartEvent.getBuildOf('target').status, 'SUCCESS');
        assert.equal(eventFactoryMock.getRunningBuild(event.id), null);
    });

    xit('[ a, c ] is not triggered when restart a b and only a was completed', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a_c.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        // run all builds
        await buildFactoryMock.run();

        const restartEvent = await event.restartFrom('hub');

        await restartEvent.getBuildOf('hub').complete('SUCCESS');
        await restartEvent.getBuildOf('a').complete('SUCCESS');

        assert.isNull(restartEvent.getBuildOf('c')); // restart build c is not triggered yet
        assert.equal(restartEvent.getBuildOf('target').status, 'CREATED');
    });

    it('[ ~sd@1:a ] is triggered in a downstream', async () => {
        const parentPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a-parent.yaml');
        const childPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a-child.yaml');

        const parentEvent = await eventFactoryMock.create({
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

        const parentEvent = await eventFactoryMock.create({
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

        await eventFactoryMock.create({
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

        const event = await eventFactoryMock.create({
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

        const event = await eventFactoryMock.create({
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

        const event = await eventFactoryMock.create({
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

        const event = await eventFactoryMock.create({
            pipelineId: parentPipeline.id,
            startFrom: 'hub'
        });

        // run all builds
        await buildFactoryMock.run();

        assert.equal(event.getBuildOf('target').status, 'SUCCESS');
    });

    describe('Stage tests', () => {
        it('test sample', async () => {
            const pipeline = await pipelineFactoryMock.createFromFile('stage-sample.yaml');

            const event = await eventFactoryMock.create({
                pipelineId: pipeline.id,
                startFrom: 'hub'
            });

            // run all builds
            await buildFactoryMock.run();

            assert.equal(event.getBuildOf('stage@red:setup').status, 'SUCCESS');
            assert.equal(event.getBuildOf('b').status, 'SUCCESS');
            assert.equal(event.getBuildOf('stage@red:teardown').status, 'SUCCESS');
            assert.equal(event.getBuildOf('target').status, 'SUCCESS');
        });
    });

    describe('Tests for behavior not ideal', () => {
        it('[ a, c ] is triggered when restart a b and only a was completed', async () => {
            const pipeline = await pipelineFactoryMock.createFromFile('a_c.yaml');

            const event = await eventFactoryMock.create({
                pipelineId: pipeline.id,
                startFrom: 'hub'
            });

            // run all builds
            await buildFactoryMock.run();

            const restartEvent = await event.restartFrom('hub');

            await restartEvent.getBuildOf('hub').complete('SUCCESS');
            await restartEvent.getBuildOf('a').complete('SUCCESS');

            assert.isNull(restartEvent.getBuildOf('c')); // restart build b is not triggered yet
            assert.equal(restartEvent.getBuildOf('target').status, 'RUNNING');
        });
    });
});
