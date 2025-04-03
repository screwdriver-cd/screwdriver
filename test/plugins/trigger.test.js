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
const { BUILD_STATUS_MESSAGES } = require('../../plugins/builds/triggers/helpers');

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
        warn: sinon.stub(),
        error: (msg, err) => console.error(msg, err)
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

    it('Multiple [ a, b ] is triggered', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a_b-multiple.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');
        await event.getBuildOf('b').complete('SUCCESS');

        assert.equal(event.getBuildOf('target1').status, 'RUNNING');
        assert.equal(event.getBuildOf('target2').status, 'RUNNING');
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

    it('[ a, b ] is triggered in restarted event when b fails once and then restarts and succeeds before a succeeds', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a_b.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('b').complete('FAILURE');
        assert.equal(event.getBuildOf('a').status, 'RUNNING');
        assert.isNull(event.getBuildOf('target'));

        const restartEvent = await event.restartFrom('b');

        await restartEvent.getBuildOf('b').complete('SUCCESS');
        assert.equal(restartEvent.getBuildOf('target').status, 'CREATED');
        await event.getBuildOf('a').complete('SUCCESS');
        assert.equal(restartEvent.getBuildOf('target').status, 'RUNNING');
        assert.isNull(event.getBuildOf('target'));

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

    it('[ a, b, c ] is triggered', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a_b_c.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');
        await event.getBuildOf('b').complete('SUCCESS');
        await event.getBuildOf('c').complete('SUCCESS');

        assert.equal(event.getBuildOf('target').status, 'RUNNING');
    });

    it('[ a, b, c ] is triggered in restarted event when a fails once and then restarts and succeeds before b,c succeeds', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a_b_c.yaml');
        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('FAILURE');

        const restartEvent = await event.restartFrom('a');

        await restartEvent.getBuildOf('a').complete('SUCCESS');
        await event.getBuildOf('b').complete('SUCCESS');
        await event.getBuildOf('c').complete('SUCCESS');

        assert.isNull(event.getBuildOf('target'));
        assert.equal(restartEvent.getBuildOf('target').status, 'RUNNING');
    });

    it('[ a, b, c ] is triggered in restarted event when a fails once and then restarts and succeeds before c succeeds', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a_b_c.yaml');
        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('FAILURE');
        await event.getBuildOf('b').complete('SUCCESS');

        const restartEvent = await event.restartFrom('a');

        await restartEvent.getBuildOf('a').complete('SUCCESS');
        await event.getBuildOf('c').complete('SUCCESS');

        assert.equal(event.getBuildOf('target').status, 'CREATED');
        assert.equal(restartEvent.getBuildOf('target').status, 'RUNNING');
    });

    it('debug [ a, b, c ] is triggered in latest restarted event once', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a_b_c.yaml');
        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');
        await event.getBuildOf('b').complete('SUCCESS');

        const restartEventA = await event.restartFrom('a');
        const restartEventB1 = await event.restartFrom('b');
        const restartEventB2 = await restartEventB1.restartFrom('b');

        await restartEventB1.getBuildOf('b').complete('SUCCESS');
        await restartEventB2.getBuildOf('b').complete('SUCCESS');
        await restartEventA.getBuildOf('a').complete('SUCCESS');
        await event.getBuildOf('c').complete('SUCCESS');

        assert.equal(event.getBuildOf('target').status, 'CREATED');
        assert.isNull(restartEventA.getBuildOf('target'));
        assert.equal(restartEventB1.getBuildOf('target').status, 'RUNNING');
        assert.equal(restartEventB2.getBuildOf('target').status, 'CREATED');
    });

    it('[ ~a, a ] is triggered', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_a.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');

        assert.equal(event.getBuildOf('target').status, 'RUNNING');
    });

    it('[ ~a, a, b ] is triggered when a succeeds', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a_a_b.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');

        assert.equal(event.getBuildOf('target').status, 'RUNNING');
    });

    it('[ a, c ] is not triggered when restart a b and only a was completed', async () => {
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
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        assert.equal(downstreamEvent.getBuildOf('target').status, 'RUNNING');

        await downstreamEvent.getBuildOf('target').complete('SUCCESS');
        assert.equal(downstreamEvent.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ ~sd@1:a ] is triggered in a upstream', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~sd@1:a.yaml');

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: 'hub'
        });

        await event.getBuildOf('hub').complete('SUCCESS');
        await event.getBuildOf('a').complete('SUCCESS');

        const externalEvent = pipeline.getLatestEvent();

        assert.equal(externalEvent.getBuildOf('target').status, 'RUNNING');

        await externalEvent.getBuildOf('target').complete('SUCCESS');
        assert.equal(externalEvent.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ ~sd@2:a ] is triggered in a upstream', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');

        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
    });

    it('Multiple [ ~sd@1:a ] are triggered', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a-multiple-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        assert.equal(downstreamEvent.getBuildOf('target1').status, 'RUNNING');
        assert.equal(downstreamEvent.getBuildOf('target2').status, 'RUNNING');
    });

    it('Multiple [ ~sd@2:a ] are triggered', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a-multiple-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');

        assert.equal(upstreamEvent.getBuildOf('target1').status, 'RUNNING');
        assert.equal(upstreamEvent.getBuildOf('target2').status, 'RUNNING');
    });

    it('[ ~sd@1:a ] is triggered in multiple downstream', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a-upstream.yaml');
        const downstreamPipeline1 = await pipelineFactoryMock.createFromFile('~sd@1:a-downstream.yaml');
        const downstreamPipeline2 = await pipelineFactoryMock.createFromFile('~sd@1:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        // run all builds
        await upstreamEvent.run();

        const downstreamEvent1 = downstreamPipeline1.getLatestEvent();
        const downstreamEvent2 = downstreamPipeline2.getLatestEvent();

        assert.equal(downstreamEvent1.getBuildOf('target').status, 'RUNNING');
        assert.equal(downstreamEvent2.getBuildOf('target').status, 'RUNNING');
    });

    it('[ ~sd@1:a ] is not triggered in a downstream when sd@1:a fails', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('FAILURE');

        assert.isNull(downstreamPipeline.getLatestEvent());
        assert.equal(downstreamPipeline.getBuildsOf('target').length, 0);
    });

    it('[ ~sd@2:a ] is not triggered in a upstream when sd@1:a fails', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('FAILURE');

        assert.isNull(upstreamEvent.getBuildOf('target'));
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 0);
    });

    it('[ ~sd@1:a ] is triggered in a downstream when sd@1:a fails once and then restarts and succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('FAILURE');

        const upstreamRestartEvent = await upstreamEvent.restartFrom('a');

        await upstreamRestartEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = await downstreamPipeline.getLatestEvent();

        assert.equal(downstreamEvent.getBuildOf('target').status, 'RUNNING');
    });

    it('[ ~sd@2:a ] is triggered in a upstream when sd@2:a fails once and then restarts and succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('FAILURE');

        const downstreamRestartEvent = await downstreamEvent.restartFrom('a');

        await downstreamRestartEvent.getBuildOf('a').complete('SUCCESS');

        const upstreamRestartEvent = upstreamPipeline.getLatestEvent();

        assert.notEqual(upstreamEvent.id, upstreamRestartEvent.id);
        assert.equal(upstreamRestartEvent.getBuildOf('target').status, 'RUNNING');
    });

    it('[ sd@1:a ] is triggered in a downstream', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@1:a-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@1:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        assert.equal(downstreamEvent.getBuildOf('target').status, 'RUNNING');

        await downstreamEvent.getBuildOf('target').complete('SUCCESS');
        assert.equal(downstreamEvent.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ sd@2:a ] is triggered in a upstream', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        // run all builds
        await upstreamEvent.run();
        await downstreamPipeline.getLatestEvent().run();

        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
    });

    it('Multiple [ sd@1:a ] are triggered in a downstream', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@1:a-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@1:a-multiple-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        assert.equal(downstreamEvent.getBuildOf('target1').status, 'RUNNING');
        assert.equal(downstreamEvent.getBuildOf('target2').status, 'RUNNING');
    });

    it('Multiple [ sd@2:a ] are triggered in a upstream', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a-multiple-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        // run all builds
        await upstreamEvent.run();
        await downstreamPipeline.getLatestEvent().run();

        assert.equal(upstreamEvent.getBuildOf('target1').status, 'RUNNING');
        assert.equal(upstreamEvent.getBuildOf('target2').status, 'RUNNING');
    });

    it('[ sd@1:a ] is triggered in multiple downstream', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@1:a-upstream.yaml');
        const downstreamPipeline1 = await pipelineFactoryMock.createFromFile('sd@1:a-downstream.yaml');
        const downstreamPipeline2 = await pipelineFactoryMock.createFromFile('sd@1:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent1 = downstreamPipeline1.getLatestEvent();
        const downstreamEvent2 = downstreamPipeline2.getLatestEvent();

        assert.equal(downstreamEvent1.getBuildOf('target').status, 'RUNNING');
        assert.equal(downstreamEvent2.getBuildOf('target').status, 'RUNNING');
    });

    it('[ sd@1:a ] is not triggered in a downstream when sd@1:a fails', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@1:a-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@1:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('FAILURE');

        assert.isNull(downstreamPipeline.getLatestEvent());
        assert.equal(downstreamPipeline.getBuildsOf('target').length, 0);
    });

    it('[ sd@2:a ] is not triggered in a upstream when sd@2:a fails', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('FAILURE');

        assert.isNull(upstreamEvent.getBuildOf('target'));
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 0);
    });

    it('[ sd@1:a ] is triggered in a downstream when sd@1:a fails once and then restarts and succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@1:a-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@1:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('FAILURE');

        const upstreamRestartEvent = await upstreamEvent.restartFrom('a');

        await upstreamRestartEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        assert.equal(downstreamEvent.getBuildOf('target').status, 'RUNNING');
    });

    it('[ sd@2:a ] is triggered in a upstream when sd@2:a fails once and then restarts and succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('FAILURE');

        const downstreamRestartEvent = await downstreamEvent.restartFrom('a');

        await downstreamRestartEvent.getBuildOf('a').complete('SUCCESS');

        const upstreamRestartEvent = await upstreamPipeline.getLatestEvent();

        assert.equal(upstreamRestartEvent.getBuildOf('target').status, 'RUNNING');
    });

    it('[ ~sd@1:a, ~sd@1:b ] is triggered when sd@1:a succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a_~sd@1:b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a_~sd@1:b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        assert.equal(downstreamEvent.getBuildOf('target').status, 'RUNNING');
    });

    it('[ ~sd@2:a, ~sd@2:b ] is triggered when sd@2:a succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_~sd@2:b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_~sd@2:b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');

        assert.equal(upstreamEvent.id, upstreamPipeline.getLatestEvent().id);
        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@1:a, ~sd@1:b ] is triggered when sd@1:a fails and sd@1:b succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a_~sd@1:b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a_~sd@1:b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('FAILURE');
        await upstreamEvent.getBuildOf('b').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        assert.equal(downstreamEvent.getBuildOf('target').status, 'RUNNING');
    });

    it('[ ~sd@2:a, ~sd@2:b ] is triggered when sd@2:a fails and sd@2:b succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_~sd@2:b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_~sd@2:b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('FAILURE');
        await downstreamEvent.getBuildOf('b').complete('SUCCESS');

        assert.equal(upstreamEvent.id, upstreamPipeline.getLatestEvent().id);
        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@1:a, ~sd@1:b ] is triggered once in a downstream when sd@1:a and sd@1:b succeed', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a_~sd@1:b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a_~sd@1:b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent1 = downstreamPipeline.getLatestEvent();

        await upstreamEvent.getBuildOf('b').complete('SUCCESS');

        const downstreamEvent2 = downstreamPipeline.getLatestEvent();

        assert.equal(downstreamEvent1.id, downstreamEvent2.id);
        assert.equal(downstreamEvent1.getBuildOf('target').status, 'RUNNING');
    });

    it('[ ~sd@2:a, ~sd@2:b ] is triggered once in a upstream when sd@2:a and sd@2:b succeed', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_~sd@2:b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_~sd@2:b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();
        await downstreamPipeline.getLatestEvent().run();

        assert.equal(upstreamEvent.id, upstreamPipeline.getLatestEvent().id);
        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@1:a, ~b ] is triggered when sd@1:a succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a_~b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a_~b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');

        const downstreamEvent1 = downstreamPipeline.getLatestEvent();

        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent2 = downstreamPipeline.getLatestEvent();

        assert.equal(downstreamEvent1.id, downstreamEvent2.id);
        assert.equal(downstreamEvent1.getBuildOf('target').status, 'RUNNING');
    });

    it('[ ~sd@2:a, ~b ] is triggered when sd@2:a succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_~b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_~b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');

        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@1:a, ~b ] is triggered when b succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a_~b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a_~b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('b').complete('SUCCESS');

        assert.equal(downstreamEvent.getBuildOf('target').status, 'RUNNING');
    });

    it('[ ~sd@2:a, ~b ] is triggered when b succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_~b-upstream.yaml');

        await pipelineFactoryMock.createFromFile('~sd@2:a_~b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');
        await upstreamEvent.getBuildOf('b').complete('SUCCESS');

        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@1:a, ~b ] is triggered once in downstream when sd@1:a and b succeed', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a_~b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a_~b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        // run all builds
        await buildFactoryMock.run();

        const [downstreamEvent1] = eventFactoryMock.getChildEvents(upstreamEvent.id);

        assert.equal(downstreamEvent1.getBuildOf('target').status, 'SUCCESS');
        assert.equal(downstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@2:a, ~b ] is triggered once in upstream when sd@2:a and b succeed', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_~b-upstream.yaml');

        await pipelineFactoryMock.createFromFile('~sd@2:a_~b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        // run all builds
        await buildFactoryMock.run();

        assert.equal(upstreamEvent.getBuildOf('target').status, 'SUCCESS');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ sd@2:a, sd@2:b ] is not triggered when only sd@2:a succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@2:b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@2:b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');

        assert.equal(upstreamEvent.getBuildOf('target').status, 'CREATED');
    });

    it('[ sd@2:a, sd@2:b ] is not triggered when sd@2:a succeeds and sd@2:b fails', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@2:b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@2:b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');
        await downstreamEvent.getBuildOf('b').complete('FAILURE');

        assert.isNull(upstreamEvent.getBuildOf('target'));
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 0);
    });

    it('[ sd@2:a, sd@2:b ] is triggered when sd@2:b fails once and then restarts and succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@2:b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@2:b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');
        await downstreamEvent.getBuildOf('b').complete('FAILURE');

        const downstreamRestartEvent = await downstreamEvent.restartFrom('b');

        await downstreamRestartEvent.getBuildOf('b').complete('SUCCESS');

        const upstreamRestartEvent = upstreamPipeline.getLatestEvent();

        assert.equal(upstreamRestartEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ sd@2:a, sd@2:b ] is not triggered when sd@2:a fails and sd@2:b restarts and succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@2:b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@2:b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('FAILURE');
        await downstreamEvent.getBuildOf('b').complete('SUCCESS');

        const downstreamRestartEvent = await downstreamEvent.restartFrom('b');

        await downstreamRestartEvent.getBuildOf('b').complete('SUCCESS');

        assert.isNull(upstreamEvent.getBuildOf('target'));
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 0);
    });

    it('[ sd@2:b, sd@2:c ] is triggered when sd@2:b and sd@2:c fail and restart and both succeed', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:b_sd@2:c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:b_sd@2:c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = await downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await downstreamEvent.getBuildOf('b').complete('FAILURE');
        await downstreamEvent.getBuildOf('c').complete('FAILURE');

        const downstreamRestartEvent = await downstreamEvent.restartFrom('hub');

        await downstreamRestartEvent.getBuildOf('hub').complete('SUCCESS');
        await downstreamRestartEvent.getBuildOf('b').complete('SUCCESS');
        await downstreamRestartEvent.getBuildOf('c').complete('SUCCESS');

        const upstreamRestartEvent = await upstreamPipeline.getLatestEvent();

        assert.isNull(upstreamEvent.getBuildOf('target'));
        assert.equal(upstreamRestartEvent.getBuildOf('target').status, 'RUNNING');
    });

    it('[ sd@2:a, sd@2:b ] is triggered', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@2:b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@2:b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');
        await downstreamEvent.getBuildOf('b').complete('SUCCESS');

        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ sd@2:a, sd@2:b ] is triggered in restart event when only sd@2:b restarts', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@2:b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@2:b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');
        await downstreamEvent.getBuildOf('b').complete('SUCCESS');

        const downstreamRestartEvent = await downstreamEvent.restartFrom('b');

        assert.isNull(downstreamRestartEvent.getBuildOf('a'));
        await downstreamRestartEvent.getBuildOf('b').complete('SUCCESS');

        const upstreamRestartEvent = upstreamPipeline.getLatestEvent();

        assert.equal(upstreamRestartEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 2);
    });

    it('Multiple [ sd@2:a, sd@2:b ] is triggered', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@2:b-multiple-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@2:b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();
        await downstreamPipeline.getLatestEvent().run();

        assert.equal(upstreamEvent.id, upstreamPipeline.getLatestEvent().id);
        assert.equal(upstreamEvent.getBuildOf('target1').status, 'RUNNING');
        assert.equal(upstreamEvent.getBuildOf('target2').status, 'RUNNING');
    });

    it('[ sd@2:c, sd@2:d ] is triggered (Multiple time Remote join)', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:c_sd@2:d-upstream.yaml');

        await pipelineFactoryMock.createFromFile('sd@2:c_sd@2:d-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await buildFactoryMock.run();

        assert.equal(upstreamEvent.id, upstreamPipeline.getLatestEvent().id);
        assert.equal(upstreamEvent.getBuildOf('target').status, 'SUCCESS');
    });

    it('[ sd@1:a, sd@1:b ] is not triggered in a downstream when only sd@1:a succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@1:a_sd@1:b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@1:a_sd@1:b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        assert.equal(downstreamEvent.getBuildOf('target').status, 'CREATED');
    });

    it('[ sd@2:a, b ] is triggered', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');
        await upstreamEvent.getBuildOf('b').complete('SUCCESS');

        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ sd@2:a, b ] is not triggered when sd@2:a succeeds and b fails', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');
        await upstreamEvent.getBuildOf('b').complete('FAILURE');

        assert.isNull(upstreamEvent.getBuildOf('target'));
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 0);
    });

    it('[ sd@2:a, b ] is triggered when sd@2:a succeeds and b fails and then restarts and succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');
        await upstreamEvent.getBuildOf('b').complete('FAILURE');

        const upstreamRestartEvent = await upstreamEvent.restartFrom('b');

        await upstreamRestartEvent.getBuildOf('b').complete('SUCCESS');

        assert.equal(upstreamRestartEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ sd@2:a, b ] is not triggered when b fails and sd@2:a restarts and succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');
        await upstreamEvent.getBuildOf('b').complete('FAILURE');

        const downstreamRestartEvent = await downstreamEvent.restartFrom('a');

        await downstreamRestartEvent.getBuildOf('a').complete('SUCCESS');

        const upstreamRestartEvent = await upstreamPipeline.getLatestEvent();

        assert.notEqual(upstreamEvent.id, upstreamRestartEvent.id);
        assert.isNull(upstreamEvent.getBuildOf('target'));
        assert.isNull(upstreamRestartEvent.getBuildOf('target'));
    });

    it('[ sd@2:a, b ] is not triggered when sd@2:a fails and b succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('FAILURE');
        await upstreamEvent.getBuildOf('b').complete('SUCCESS');

        assert.equal(upstreamEvent.getBuildOf('target').status, 'CREATED');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ sd@2:a, b ] is not triggered when sd@2:a fails and b restarts and succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('FAILURE');
        await upstreamEvent.getBuildOf('b').complete('SUCCESS');

        const upstreamRestartEvent = await upstreamEvent.restartFrom('b');

        await upstreamRestartEvent.getBuildOf('b').complete('SUCCESS');

        assert.equal(upstreamEvent.getBuildOf('target').status, 'CREATED');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
        assert.isNull(upstreamRestartEvent.getBuildOf('target'));
    });

    it('[ sd@2:a, b ] is triggered when b succeeds and sd@2:a fails and then restarts and succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('FAILURE');
        await upstreamEvent.getBuildOf('b').complete('SUCCESS');

        const downstreamRestartEvent = await downstreamEvent.restartFrom('a');

        await downstreamRestartEvent.getBuildOf('a').complete('SUCCESS');

        const upstreamRestartEvent = await upstreamPipeline.getLatestEvent();

        assert.equal(upstreamEvent.getBuildOf('target').status, 'CREATED');
        assert.equal(upstreamRestartEvent.getBuildOf('target').status, 'RUNNING');
    });

    it('[ sd@2:a, b ] is triggered in restart event when only b restarts', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');

        const upstreamRestartEvent = await upstreamEvent.restartFrom('b');

        await upstreamRestartEvent.getBuildOf('b').complete('SUCCESS');

        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamRestartEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 2);
    });

    it('[ sd@2:a, sd@3:a ] is triggered', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-upstream.yaml');
        const downstreamPipeline1 = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-downstream.yaml');
        const downstreamPipeline2 = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        // run all builds
        await upstreamEvent.run();

        const downstreamEvent1 = downstreamPipeline1.getLatestEvent();
        const downstreamEvent2 = downstreamPipeline2.getLatestEvent();

        // run all builds
        await downstreamEvent1.run();
        await downstreamEvent2.run();

        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ sd@2:a, sd@3:a ] is not triggered when sd@2:a succeeds and sd@3:a fails', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-upstream.yaml');
        const downstreamPipeline1 = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-downstream.yaml');
        const downstreamPipeline2 = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        // run all builds
        await upstreamEvent.run();

        const downstreamEvent1 = downstreamPipeline1.getLatestEvent();
        const downstreamEvent2 = downstreamPipeline2.getLatestEvent();

        await downstreamEvent1.getBuildOf('a').complete('SUCCESS');
        await downstreamEvent2.getBuildOf('a').complete('FAILURE');

        assert.isNull(upstreamEvent.getBuildOf('target'));
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 0);
    });

    it('[ sd@2:a, sd@3:a ] is not triggered when sd@3:a fails and sd@2:a restarts and succeeds ', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-upstream.yaml');
        const downstreamPipeline1 = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-downstream.yaml');
        const downstreamPipeline2 = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        // run all builds
        await upstreamEvent.run();

        const downstreamEvent1 = downstreamPipeline1.getLatestEvent();
        const downstreamEvent2 = downstreamPipeline2.getLatestEvent();

        await downstreamEvent1.getBuildOf('a').complete('SUCCESS');
        await downstreamEvent2.getBuildOf('a').complete('FAILURE');

        const downstreamRestartEvent1 = await downstreamEvent1.restartFrom('a');

        await downstreamRestartEvent1.getBuildOf('a').complete('SUCCESS');

        const upstreamRestartEvent = upstreamPipeline.getLatestEvent();

        assert.notEqual(upstreamEvent.id, upstreamRestartEvent.id);
        assert.isNull(upstreamEvent.getBuildOf('target'));
        assert.isNull(upstreamRestartEvent.getBuildOf('target'));
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 0);
    });

    it('[ sd@2:a, sd@3:a ] is triggered when sd@2:a success and sd@3:a fails and then restarts and succeeds ', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-upstream.yaml');
        const downstreamPipeline1 = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-downstream.yaml');
        const downstreamPipeline2 = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        // run all builds
        await upstreamEvent.run();

        const downstreamEvent1 = downstreamPipeline1.getLatestEvent();
        const downstreamEvent2 = downstreamPipeline2.getLatestEvent();

        await downstreamEvent1.getBuildOf('a').complete('SUCCESS');
        await downstreamEvent2.getBuildOf('a').complete('FAILURE');

        const downstreamRestartEvent2 = await downstreamEvent2.restartFrom('a');

        await downstreamRestartEvent2.getBuildOf('a').complete('SUCCESS');

        const upstreamRestartEvent = await upstreamPipeline.getLatestEvent();

        assert.isNull(upstreamEvent.getBuildOf('target'));
        assert.equal(upstreamRestartEvent.getBuildOf('target').status, 'RUNNING');
    });

    it('[ sd@2:a, sd@3:a ] is triggered in restart event when only sd@3:a restarts', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-upstream.yaml');
        const downstreamPipeline1 = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-downstream.yaml');
        const downstreamPipeline2 = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent1 = downstreamPipeline1.getLatestEvent();
        const downstreamEvent2 = downstreamPipeline2.getLatestEvent();

        await downstreamEvent1.getBuildOf('a').complete('SUCCESS');
        await downstreamEvent2.getBuildOf('a').complete('SUCCESS');

        const downstreamRestartEvent2 = await downstreamEvent2.restartFrom('a');

        await downstreamRestartEvent2.getBuildOf('a').complete('SUCCESS');

        const upstreamRestartEvent = upstreamPipeline.getLatestEvent();

        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamRestartEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 2);
    });

    it('[ a, sd@2:a, sd@3:a ] is triggered when restarts a and wait for downstream restart builds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('a_sd@2:a_sd@3:a-upstream.yaml');
        const downstreamPipeline1 = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-downstream.yaml');
        const downstreamPipeline2 = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        // run all builds
        await upstreamEvent.run();

        const downstreamEvent1 = downstreamPipeline1.getLatestEvent();
        const downstreamEvent2 = downstreamPipeline2.getLatestEvent();

        await downstreamEvent1.getBuildOf('a').complete('SUCCESS');
        await downstreamEvent2.getBuildOf('a').complete('SUCCESS');
        await upstreamEvent.getBuildOf('target').complete('SUCCESS');

        const upstreamRestartEvent = await upstreamEvent.restartFrom('a');

        assert.isNull(upstreamRestartEvent.getBuildOf('target'));

        await upstreamRestartEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamRestartEvent1 = downstreamPipeline1.getLatestEvent();
        const downstreamRestartEvent2 = downstreamPipeline2.getLatestEvent();

        await downstreamRestartEvent1.getBuildOf('a').complete('SUCCESS');
        await downstreamRestartEvent2.getBuildOf('a').complete('SUCCESS');

        assert.equal(upstreamRestartEvent.getBuildOf('target').status, 'RUNNING');

        assert.equal(upstreamPipeline.getBuildsOf('target').length, 2);
    });

    it('[ b, sd@2:a, sd@3:a ] is triggered when restarts a and wait for downstream restart builds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('b_sd@2:a_sd@3:a-upstream.yaml');
        const downstreamPipeline1 = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-downstream.yaml');
        const downstreamPipeline2 = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        // run all builds
        await upstreamEvent.run();

        const downstreamEvent1 = downstreamPipeline1.getLatestEvent();
        const downstreamEvent2 = downstreamPipeline2.getLatestEvent();

        await downstreamEvent1.getBuildOf('a').complete('SUCCESS');
        await downstreamEvent2.getBuildOf('a').complete('SUCCESS');
        await upstreamEvent.getBuildOf('target').complete('SUCCESS');

        const upstreamRestartEvent = await upstreamEvent.restartFrom('hub');

        await upstreamRestartEvent.getBuildOf('hub').complete('SUCCESS');

        assert.isNull(upstreamRestartEvent.getBuildOf('target'));

        await upstreamRestartEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamRestartEvent1 = downstreamPipeline1.getLatestEvent();
        const downstreamRestartEvent2 = downstreamPipeline2.getLatestEvent();

        await upstreamRestartEvent.getBuildOf('b').complete('SUCCESS');
        await downstreamRestartEvent1.getBuildOf('a').complete('SUCCESS');
        await downstreamRestartEvent2.getBuildOf('a').complete('SUCCESS');

        assert.equal(upstreamRestartEvent.getBuildOf('target').status, 'RUNNING');

        assert.equal(upstreamPipeline.getBuildsOf('target').length, 2);
    });

    it('[ ~sd@2:a, sd@2:b, sd@2:c ] is triggered when sd@2:a succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:b_sd@2:c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:b_sd@2:c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');

        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@2:a, sd@2:b, sd@2:c ] is triggered', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:b_sd@2:c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:b_sd@2:c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');
        await downstreamEvent.getBuildOf('b').complete('SUCCESS');
        await downstreamEvent.getBuildOf('c').complete('SUCCESS');

        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@2:a, sd@2:b, sd@2:c ] is triggered when sd@2:a fails and sd@2:b succeeds and sd@2:c succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:b_sd@2:c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:b_sd@2:c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('FAILURE');
        await downstreamEvent.getBuildOf('b').complete('SUCCESS');
        await downstreamEvent.getBuildOf('c').complete('SUCCESS');

        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@2:a, sd@2:b, sd@2:c ] is not triggered when sd@2:a fails and sd@2:b succeeds and sd@2:c fails', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:b_sd@2:c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:b_sd@2:c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('FAILURE');
        await downstreamEvent.getBuildOf('b').complete('SUCCESS');
        await downstreamEvent.getBuildOf('c').complete('FAILURE');

        assert.isNull(upstreamEvent.getBuildOf('target'));
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 0);
    });

    it('[ ~sd@2:a, sd@2:b, sd@2:c ] is triggered when sd@2:a fails and sd@2:b succeeds and sd@2:c restarts and succeeds ', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:b_sd@2:c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:b_sd@2:c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('FAILURE');
        await downstreamEvent.getBuildOf('b').complete('SUCCESS');
        await downstreamEvent.getBuildOf('c').complete('FAILURE');

        const downstreamRestartEvent = await downstreamEvent.restartFrom('c');

        await downstreamRestartEvent.getBuildOf('c').complete('SUCCESS');

        const upstreamRestartEvent = await upstreamPipeline.getLatestEvent();

        assert.isNull(upstreamEvent.getBuildOf('target'));
        assert.equal(upstreamRestartEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@2:a, sd@2:b, sd@2:c ] is triggered in restart event when only sd@2:c restarts', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:b_sd@2:c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:b_sd@2:c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');
        await downstreamEvent.getBuildOf('b').complete('SUCCESS');
        await downstreamEvent.getBuildOf('c').complete('SUCCESS');

        const downstreamRestartEvent = await downstreamEvent.restartFrom('c');

        assert.isNull(downstreamRestartEvent.getBuildOf('b'));
        await downstreamRestartEvent.getBuildOf('c').complete('SUCCESS');

        const upstreamRestartEvent = upstreamPipeline.getLatestEvent();

        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamRestartEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 2);
    });

    it('[ ~sd@2:a, b, c ] is triggered', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_b_c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_b_c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');
        await upstreamEvent.getBuildOf('b').complete('SUCCESS');
        await upstreamEvent.getBuildOf('c').complete('SUCCESS');

        assert.equal(upstreamEvent, upstreamPipeline.getLatestEvent());
        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@2:a, b, c ] is triggered when sd@2:a fails and b succeeds and c succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_b_c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_b_c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('FAILURE');
        await upstreamEvent.getBuildOf('b').complete('SUCCESS');
        await upstreamEvent.getBuildOf('c').complete('SUCCESS');

        assert.equal(upstreamEvent, upstreamPipeline.getLatestEvent());
        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@2:a, b, c ] is not triggered when sd@2:a fails and b succeeds and c fails', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_b_c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_b_c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('FAILURE');
        await upstreamEvent.getBuildOf('b').complete('SUCCESS');
        await upstreamEvent.getBuildOf('c').complete('FAILURE');

        assert.isNull(upstreamEvent.getBuildOf('target'));
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 0);
    });

    it('[ ~sd@2:a, sd@2:b, c ] is trigger', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:b_c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:b_c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');
        await downstreamEvent.getBuildOf('b').complete('SUCCESS');
        await upstreamEvent.getBuildOf('c').complete('SUCCESS');

        assert.equal(upstreamEvent, upstreamPipeline.getLatestEvent());
        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@2:a, sd@2:b, c ] is trigger when sd@2:a fails and sd@2:b succeeds and c succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:b_c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:b_c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('FAILURE');
        await downstreamEvent.getBuildOf('b').complete('SUCCESS');
        await upstreamEvent.getBuildOf('c').complete('SUCCESS');

        assert.equal(upstreamEvent, upstreamPipeline.getLatestEvent());
        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@2:a, sd@2:b, c ] is not trigger when sd@2:a fails and sd@2:b succeeds and c fails', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:b_c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:b_c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('FAILURE');
        await downstreamEvent.getBuildOf('b').complete('SUCCESS');
        await upstreamEvent.getBuildOf('c').complete('FAILURE');

        assert.isNull(upstreamEvent.getBuildOf('target'));
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 0);
    });

    it('[ ~a, sd@2:b, sd@2:c ] is trigger', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~a_sd@2:b_sd@2:c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~a_sd@2:b_sd@2:c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await upstreamEvent.getBuildOf('a').complete('SUCCESS');
        await downstreamEvent.getBuildOf('b').complete('SUCCESS');
        await downstreamEvent.getBuildOf('c').complete('SUCCESS');

        assert.equal(upstreamEvent, upstreamPipeline.getLatestEvent());
        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~a, sd@2:b, sd@2:c ] is trigger when a fails and sd@2:b succeeds and sd@2:c succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~a_sd@2:b_sd@2:c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~a_sd@2:b_sd@2:c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await upstreamEvent.getBuildOf('a').complete('FAILURE');
        await downstreamEvent.getBuildOf('b').complete('SUCCESS');
        await downstreamEvent.getBuildOf('c').complete('SUCCESS');

        assert.equal(upstreamEvent, upstreamPipeline.getLatestEvent());
        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~a, sd@2:b, sd@2:c ] is not trigger when a fails and sd@2:b succeeds and sd@2:c fails', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~a_sd@2:b_sd@2:c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~a_sd@2:b_sd@2:c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await upstreamEvent.getBuildOf('a').complete('FAILURE');
        await downstreamEvent.getBuildOf('b').complete('SUCCESS');
        await downstreamEvent.getBuildOf('c').complete('FAILURE');

        assert.isNull(upstreamEvent.getBuildOf('target'));
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 0);
    });

    it('[ ~a, b, sd@2:c ] is trigger', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~a_b_sd@2:c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~a_b_sd@2:c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await upstreamEvent.getBuildOf('a').complete('SUCCESS');
        await upstreamEvent.getBuildOf('b').complete('SUCCESS');
        await downstreamEvent.getBuildOf('c').complete('SUCCESS');

        assert.equal(upstreamEvent, upstreamPipeline.getLatestEvent());
        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~a, b, sd@2:c ] is trigger when a fails and b succeeds and sd@2:c succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~a_b_sd@2:c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~a_b_sd@2:c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await upstreamEvent.getBuildOf('a').complete('FAILURE');
        await upstreamEvent.getBuildOf('b').complete('SUCCESS');
        await downstreamEvent.getBuildOf('c').complete('SUCCESS');

        assert.equal(upstreamEvent, upstreamPipeline.getLatestEvent());
        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~a, b, sd@2:c ] is not trigger when a fails and b succeeds and sd@2:c fails', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~a_b_sd@2:c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~a_b_sd@2:c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await upstreamEvent.getBuildOf('a').complete('FAILURE');
        await upstreamEvent.getBuildOf('b').complete('SUCCESS');
        await downstreamEvent.getBuildOf('c').complete('FAILURE');

        assert.isNull(upstreamEvent.getBuildOf('target'));
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 0);
    });

    xit('[ ~a, b, sd@2:c ] is not trigger when only restart b succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~a_b_sd@2:c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~a_b_sd@2:c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        // Run all builds
        await buildFactoryMock.run();

        // Restart case
        const upstreamRestartEvent = await upstreamEvent.restartFrom('hub');

        await upstreamRestartEvent.getBuildOf('hub').complete('SUCCESS');

        const downstreamRestartEvent = downstreamPipeline.getLatestEvent();

        await downstreamRestartEvent.getBuildOf('c').complete('FAILURE');
        await upstreamRestartEvent.getBuildOf('b').complete('SUCCESS');

        assert.isNull(upstreamRestartEvent.getBuildOf('target'));
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ sd@2:a, sd@2:b, sd@2:c ] is triggered', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@2:b_sd@2:c-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@2:b_sd@2:c-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');
        await downstreamEvent.getBuildOf('b').complete('SUCCESS');
        await downstreamEvent.getBuildOf('c').complete('SUCCESS');

        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@1:a, ~sd@1:a ] is triggered', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a_~sd@1:a-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a_~sd@1:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        assert.equal(downstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(downstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@1:a, sd@1:a ] is triggered', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a_sd@1:a-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a_sd@1:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        assert.equal(downstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(downstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@1:a, sd@1:a, sd@1:b ] is triggered when sd@1:a succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a_sd@1:a_sd@1:b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a_sd@1:a_sd@1:b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        assert.equal(downstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(downstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@2:a, ~sd@2:a ] is triggered', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_~sd@2:a-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_~sd@2:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');

        assert.equal(upstreamEvent.id, upstreamPipeline.getLatestEvent().id);
        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@2:a, sd@2:a ] is triggered', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:a-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');

        assert.equal(upstreamEvent.id, upstreamPipeline.getLatestEvent().id);
        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@2:a, sd@2:a, sd@2:b ] is triggered when sd@2:a succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:a_sd@2:b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:a_sd@2:b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');

        assert.equal(upstreamEvent.id, upstreamPipeline.getLatestEvent().id);
        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@2:a, sd@2:a, sd@2:b ] is triggered in restart event when only sd@1:a restarts', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:a_sd@2:b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a_sd@2:a_sd@2:b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');
        await downstreamEvent.getBuildOf('b').complete('SUCCESS');

        const downstreamRestartEvent = await downstreamEvent.restartFrom('a');

        await downstreamRestartEvent.getBuildOf('a').complete('SUCCESS');

        const upstreamRestartEvent = upstreamPipeline.getLatestEvent();

        assert.equal(upstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamRestartEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 2);
    });

    it('[ sd@3:a, sd@3:b ] is triggered in second stream pipeline', async () => {
        const firstPipeline = await pipelineFactoryMock.createFromFile('sd@3:a_sd@3:b-first.yaml');
        const secondPipeline = await pipelineFactoryMock.createFromFile('sd@3:a_sd@3:b-second.yaml');
        const thirdPipeline = await pipelineFactoryMock.createFromFile('sd@3:a_sd@3:b-third.yaml');

        const firstEvent = await eventFactoryMock.create({
            pipelineId: firstPipeline.id,
            startFrom: 'hub'
        });

        await firstEvent.run();

        const secondEvent = secondPipeline.getLatestEvent();

        await secondEvent.run();

        const thirdEvent = thirdPipeline.getLatestEvent();

        await thirdEvent.run();

        assert.equal(secondEvent.id, secondPipeline.getLatestEvent().id);
        assert.equal(secondEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(secondPipeline.getBuildsOf('target').length, 1);
    });

    it('[ sd@2:b, sd@3:a ] is triggered in first stream pipeline (Child and Grandchild Remote join)', async () => {
        const firstPipeline = await pipelineFactoryMock.createFromFile('sd@2:b_sd@3:a-first.yaml');
        const secondPipeline = await pipelineFactoryMock.createFromFile('sd@2:b_sd@3:a-second.yaml');
        const thirdPipeline = await pipelineFactoryMock.createFromFile('sd@2:b_sd@3:a-third.yaml');

        const firstEvent = await eventFactoryMock.create({
            pipelineId: firstPipeline.id,
            startFrom: 'hub'
        });

        await firstEvent.run();

        const secondEvent = secondPipeline.getLatestEvent();

        await secondEvent.getBuildOf('a').complete('SUCCESS');

        const thirdEvent = thirdPipeline.getLatestEvent();

        await secondEvent.getBuildOf('b').complete('SUCCESS');

        assert.equal(firstEvent.getBuildOf('target').status, 'CREATED');

        await thirdEvent.getBuildOf('a').complete('SUCCESS');

        assert.equal(firstEvent.id, firstPipeline.getLatestEvent().id);
        assert.equal(firstEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(firstPipeline.getBuildsOf('target').length, 1);
    });

    it('[ ~sd@1:a ], [ ~sd@1:b ] is triggered by same groupEventId when sd@1:a succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a_~sd@1:b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('a_b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');
        const downstreamEvent = downstreamPipeline.getLatestEvent();

        assert.equal(downstreamEvent.getBuildOf('a').status, 'RUNNING');
        assert.isNull(downstreamEvent.getBuildOf('b'));

        await upstreamEvent.getBuildOf('b').complete('SUCCESS');
        assert.equal(downstreamEvent.getBuildOf('b').status, 'RUNNING');

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');
        await downstreamEvent.getBuildOf('b').complete('SUCCESS');

        assert.equal(downstreamEvent.id, downstreamPipeline.getLatestEvent().id);
        assert.equal(downstreamEvent.getBuildOf('target').status, 'RUNNING');
    });

    it('[ a, b ] in downstream is not triggered by same groupEventId', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a_~sd@1:b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('a_b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
        await upstreamEvent.getBuildOf('a').complete('SUCCESS');
        const downstreamEvent = downstreamPipeline.getLatestEvent();

        assert.isNull(downstreamEvent.getBuildOf('b'));
        assert.equal(downstreamEvent.getBuildOf('a').status, 'RUNNING');
        await downstreamEvent.getBuildOf('a').complete('SUCCESS');

        await upstreamEvent.getBuildOf('b').complete('SUCCESS');

        assert.equal(downstreamEvent.getBuildOf('b').status, 'RUNNING');
        await downstreamEvent.getBuildOf('b').complete('SUCCESS');

        assert.equal(downstreamEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(downstreamEvent, downstreamPipeline.getLatestEvent());
    });

    it('[ ~sd@2:a ] is triggered in a upstream when restarts and succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@2:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');
        await upstreamEvent.getBuildOf('target').complete('SUCCESS');

        // Restart
        const upstreamRestartEvent = await upstreamEvent.restartFrom('a');

        await upstreamRestartEvent.getBuildOf('a').complete('SUCCESS');
        assert.equal(upstreamEvent.groupEventId, upstreamRestartEvent.groupEventId);
        assert.isNull(upstreamRestartEvent.getBuildOf('target'));

        // downstream (after restart)
        const downstreamRestartEvent = downstreamPipeline.getLatestEvent();

        assert.notEqual(downstreamEvent.id, downstreamRestartEvent.id);
        assert.equal(downstreamEvent.groupEventId, downstreamRestartEvent.groupEventId);

        await downstreamRestartEvent.getBuildOf('a').complete('SUCCESS');

        assert.equal(upstreamRestartEvent.getBuildOf('target').status, 'RUNNING');
    });

    it('[ ~sd@1:b ] is triggered in a downstream when restarts and succeeds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a-and-~sd@1:b-upstream.yaml');
        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a-and-~sd@1:b-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        // run all builds
        await upstreamEvent.run();

        const downstreamEvent = downstreamPipeline.getLatestEvent();

        await downstreamEvent.getBuildOf('a').complete('SUCCESS');
        await upstreamEvent.getBuildOf('b').complete('SUCCESS');

        assert.equal(downstreamEvent.getBuildOf('target').status, 'RUNNING');

        const upstreamRestartEvent = await upstreamEvent.restartFrom('a');

        await upstreamRestartEvent.getBuildOf('a').complete('SUCCESS');
        const downstreamRestartEvent = downstreamPipeline.getLatestEvent();

        await downstreamRestartEvent.getBuildOf('a').complete('SUCCESS');
        assert.notEqual(downstreamEvent.id, downstreamRestartEvent.id);

        assert.equal(upstreamRestartEvent.id, upstreamPipeline.getLatestEvent().id);

        await upstreamRestartEvent.getBuildOf('b').complete('SUCCESS');

        assert.equal(downstreamRestartEvent.id, downstreamPipeline.getLatestEvent().id);
        assert.equal(downstreamRestartEvent.getBuildOf('target').status, 'RUNNING');
    });

    it('[ sd@2:a, sd@3:a ] is triggered when restarts a and wait for downstream restart builds', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-upstream.yaml');
        const downstreamPipeline1 = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-downstream.yaml');
        const downstreamPipeline2 = await pipelineFactoryMock.createFromFile('sd@2:a_sd@3:a-downstream.yaml');

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: 'hub'
        });

        // run all builds
        await upstreamEvent.run();

        const downstreamEvent1 = downstreamPipeline1.getLatestEvent();
        const downstreamEvent2 = downstreamPipeline2.getLatestEvent();

        await downstreamEvent1.getBuildOf('a').complete('SUCCESS');
        await downstreamEvent2.getBuildOf('a').complete('SUCCESS');
        await upstreamEvent.getBuildOf('target').complete('SUCCESS');

        const upstreamRestartEvent = await upstreamEvent.restartFrom('hub');

        await upstreamRestartEvent.getBuildOf('hub').complete('SUCCESS');

        assert.isNull(upstreamRestartEvent.getBuildOf('target'));

        await upstreamRestartEvent.getBuildOf('a').complete('SUCCESS');

        const downstreamRestartEvent1 = downstreamPipeline1.getLatestEvent();
        const downstreamRestartEvent2 = downstreamPipeline2.getLatestEvent();

        await downstreamRestartEvent1.getBuildOf('a').complete('SUCCESS');
        await downstreamRestartEvent2.getBuildOf('a').complete('SUCCESS');

        assert.equal(upstreamRestartEvent.getBuildOf('target').status, 'RUNNING');
        assert.equal(upstreamPipeline.getBuildsOf('target').length, 2);
    });

    it('[ ~pr ] is triggered', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~pr.yaml');

        pipeline.addPRJobs(1);

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: '~pr',
            pr: { ref: 'PR1' }
        });

        assert.equal(event.getBuildOf('PR-1:target').status, 'RUNNING');

        await event.getBuildOf('PR-1:target').complete('SUCCESS');

        assert.equal(event.getBuildOf('PR-1:target').status, 'SUCCESS');
    });

    it('[ ~a ] is not triggered when chainPR disabled', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a-PR.yaml');

        pipeline.addPRJobs(1);
        pipeline.chainPR = false;

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: '~pr',
            pr: { ref: 'PR1' }
        });

        await event.getBuildOf('PR-1:a').complete('SUCCESS');
        assert.isNull(event.getBuildOf('PR-1:target'));
    });

    it('[ ~a ] is triggered when chainPR enabled', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('~a-PR.yaml');

        pipeline.addPRJobs(1);
        pipeline.chainPR = true;

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: '~pr',
            pr: { ref: 'PR1' }
        });

        await event.getBuildOf('PR-1:a').complete('SUCCESS');

        assert.equal(event.getBuildOf('PR-1:target').status, 'RUNNING');
    });

    it('[ a, b ] is triggered when chainPR enabled', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a_b-PR.yaml');

        pipeline.addPRJobs(1);
        pipeline.chainPR = true;

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: '~pr',
            pr: { ref: 'PR1' }
        });

        await event.getBuildOf('PR-1:a').complete('SUCCESS');

        assert.equal(event.getBuildOf('PR-1:target').status, 'CREATED');

        await event.getBuildOf('PR-1:b').complete('SUCCESS');

        assert.equal(event.getBuildOf('PR-1:target').status, 'RUNNING');
    });

    it('[ a, b ] is not triggered when chainPR disabled', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('a_b-PR.yaml');

        pipeline.addPRJobs(1);
        pipeline.chainPR = false;

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: '~pr',
            pr: { ref: 'PR1' }
        });

        await event.getBuildOf('PR-1:a').complete('SUCCESS');
        await event.getBuildOf('PR-1:b').complete('SUCCESS');

        assert.isNull(event.getBuildOf('PR-1:target'));
    });

    it('[ d ] is triggered when chainPR enabled', async () => {
        const pipeline = await pipelineFactoryMock.createFromFile('d-PR.yaml');

        pipeline.addPRJobs(1);
        pipeline.chainPR = true;

        const event = await eventFactoryMock.create({
            pipelineId: pipeline.id,
            startFrom: '~pr',
            pr: { ref: 'PR1' }
        });

        await event.getBuildOf('PR-1:a').complete('SUCCESS');
        await event.getBuildOf('PR-1:b').complete('SUCCESS');
        await event.getBuildOf('PR-1:c').complete('SUCCESS');
        await event.getBuildOf('PR-1:d').complete('SUCCESS');

        assert.equal(event.getBuildOf('PR-1:target').status, 'RUNNING');
    });

    it('[ ~sd@1:a ] is not triggered in PR build when chainPR enabled', async () => {
        const upstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a-PR-upstream.yaml');

        upstreamPipeline.addPRJobs(1);
        upstreamPipeline.chainPR = true;

        const downstreamPipeline = await pipelineFactoryMock.createFromFile('~sd@1:a-PR-downstream.yaml');

        downstreamPipeline.addPRJobs(1);
        downstreamPipeline.chainPR = true;

        const upstreamEvent = await eventFactoryMock.create({
            pipelineId: upstreamPipeline.id,
            startFrom: '~pr',
            pr: { ref: 'PR1' }
        });

        await upstreamEvent.getBuildOf('PR-1:a').complete('SUCCESS');

        assert.isNull(downstreamPipeline.getLatestEvent());
        assert.equal(downstreamPipeline.getBuildsOf('target').length, 0);
        assert.equal(downstreamPipeline.getBuildsOf('PR-1:target').length, 0);
    });

    describe('stages', () => {
        it('stage setup is triggered', async () => {
            const pipeline = await pipelineFactoryMock.createFromFile('stage-explicit-setup-teardown.yaml');

            const event = await eventFactoryMock.create({
                pipelineId: pipeline.id,
                startFrom: 'hub'
            });

            await event.getBuildOf('hub').complete('SUCCESS');
            await event.getBuildOf('a').complete('SUCCESS');

            assert.equal(event.getBuildOf('stage@red:setup').status, 'RUNNING');
        });

        it('stage implicit (virtual) setup is bypassed and its downstream is triggered', async () => {
            const pipeline = await pipelineFactoryMock.createFromFile('stage-implicit-setup-teardown.yaml');

            const event = await eventFactoryMock.create({
                pipelineId: pipeline.id,
                startFrom: 'hub'
            });

            await event.getBuildOf('hub').complete('SUCCESS');
            await event.getBuildOf('a').complete('SUCCESS');

            assert.equal(event.getBuildOf('stage@red:setup').status, 'SUCCESS');
            assert.equal(
                event.getBuildOf('stage@red:setup').statusMessage,
                BUILD_STATUS_MESSAGES.SKIP_VIRTUAL_JOB.statusMessage
            );
            assert.equal(
                event.getBuildOf('stage@red:setup').statusMessageType,
                BUILD_STATUS_MESSAGES.SKIP_VIRTUAL_JOB.statusMessageType
            );

            assert.equal(event.getBuildOf('target1').status, 'RUNNING');
            assert.equal(event.getBuildOf('target2').status, 'RUNNING');
        });

        it('stage is triggered by stage', async () => {
            const pipeline = await pipelineFactoryMock.createFromFile('stage-to-stage.yaml');

            const event = await eventFactoryMock.create({
                pipelineId: pipeline.id,
                startFrom: 'hub'
            });

            // run all builds
            await event.run();

            assert.equal(event.getBuildOf('target').status, 'SUCCESS');
        });

        it('stage jobs are triggered', async () => {
            const pipeline = await pipelineFactoryMock.createFromFile('stage-explicit-setup-teardown.yaml');

            const event = await eventFactoryMock.create({
                pipelineId: pipeline.id,
                startFrom: 'hub'
            });

            await event.getBuildOf('hub').complete('SUCCESS');
            await event.getBuildOf('a').complete('SUCCESS');

            assert.isNull(event.getBuildOf('target1'));
            assert.isNull(event.getBuildOf('target2'));

            await event.getBuildOf('stage@red:setup').complete('SUCCESS');

            // triggered by stage setup job
            assert.equal(event.getBuildOf('target1').status, 'RUNNING');
            assert.equal(event.getBuildOf('target2').status, 'RUNNING');

            await event.getBuildOf('target1').complete('SUCCESS');

            assert.equal(event.getBuildOf('target3').status, 'CREATED');

            await event.getBuildOf('target2').complete('SUCCESS');

            // overwrite stage job's required
            assert.equal(event.getBuildOf('target3').status, 'RUNNING');
        });

        it('stage teardown is triggered', async () => {
            const pipeline = await pipelineFactoryMock.createFromFile('stage-explicit-setup-teardown.yaml');

            const event = await eventFactoryMock.create({
                pipelineId: pipeline.id,
                startFrom: 'hub'
            });

            await event.getBuildOf('hub').complete('SUCCESS');
            await event.getBuildOf('a').complete('SUCCESS');
            await event.getBuildOf('stage@red:setup').complete('SUCCESS');
            await event.getBuildOf('target1').complete('SUCCESS');
            await event.getBuildOf('target2').complete('SUCCESS');

            assert.isNull(event.getBuildOf('stage@red:teardown'));

            await event.getBuildOf('target3').complete('SUCCESS');

            assert.equal(event.getBuildOf('stage@red:teardown').status, 'RUNNING');
        });

        it('stage implicit (virtual) teardown is bypassed and its downstream is triggered', async () => {
            const pipeline = await pipelineFactoryMock.createFromFile('stage-implicit-setup-teardown.yaml');

            const event = await eventFactoryMock.create({
                pipelineId: pipeline.id,
                startFrom: 'hub'
            });

            await event.getBuildOf('hub').complete('SUCCESS');
            await event.getBuildOf('a').complete('SUCCESS');

            assert.equal(event.getBuildOf('stage@red:setup').status, 'SUCCESS');

            await event.getBuildOf('target1').complete('SUCCESS');
            await event.getBuildOf('target2').complete('SUCCESS');

            assert.isNull(event.getBuildOf('stage@red:teardown'));

            await event.getBuildOf('target3').complete('SUCCESS');

            assert.equal(event.getBuildOf('stage@red:teardown').status, 'SUCCESS');
            assert.equal(
                event.getBuildOf('stage@red:teardown').statusMessage,
                BUILD_STATUS_MESSAGES.SKIP_VIRTUAL_JOB.statusMessage
            );
            assert.equal(
                event.getBuildOf('stage@red:teardown').statusMessageType,
                BUILD_STATUS_MESSAGES.SKIP_VIRTUAL_JOB.statusMessageType
            );

            assert.equal(event.getBuildOf('z').status, 'RUNNING');
        });

        it('stage teardown is triggered when some stage builds fail', async () => {
            const pipeline = await pipelineFactoryMock.createFromFile('stage-explicit-setup-teardown.yaml');

            const event = await eventFactoryMock.create({
                pipelineId: pipeline.id,
                startFrom: 'hub'
            });

            await event.getBuildOf('hub').complete('SUCCESS');
            await event.getBuildOf('a').complete('SUCCESS');
            await event.getBuildOf('stage@red:setup').complete('SUCCESS');
            await event.getBuildOf('target1').complete('SUCCESS');
            await event.getBuildOf('target2').complete('SUCCESS');
            await event.getBuildOf('target3').complete('FAILURE');

            assert.equal(event.getBuildOf('stage@red:teardown').status, 'RUNNING');
        });

        it('[ ~stage@red:setup ] is triggered', async () => {
            const pipeline = await pipelineFactoryMock.createFromFile('~stage@red:setup.yaml');

            const event = await eventFactoryMock.create({
                pipelineId: pipeline.id,
                startFrom: 'hub'
            });

            await event.getBuildOf('hub').complete('SUCCESS');
            await event.getBuildOf('a').complete('SUCCESS');
            await event.getBuildOf('stage@red:setup').complete('SUCCESS');

            assert.equal(event.getBuildOf('target').status, 'RUNNING');
        });

        it('[ ~stage@red:teardown ] is triggered', async () => {
            const pipeline = await pipelineFactoryMock.createFromFile('~stage@red:teardown.yaml');

            const event = await eventFactoryMock.create({
                pipelineId: pipeline.id,
                startFrom: 'hub'
            });

            await event.getBuildOf('hub').complete('SUCCESS');
            await event.getBuildOf('a').complete('SUCCESS');
            await event.getBuildOf('stage@red:setup').complete('SUCCESS');
            await event.getBuildOf('b').complete('SUCCESS');
            await event.getBuildOf('stage@red:teardown').complete('SUCCESS');

            assert.equal(event.getBuildOf('target').status, 'RUNNING');
        });

        it('[ ~stage@red ] is triggered', async () => {
            const pipeline = await pipelineFactoryMock.createFromFile('~stage@red.yaml');

            const event = await eventFactoryMock.create({
                pipelineId: pipeline.id,
                startFrom: 'hub'
            });

            await event.getBuildOf('hub').complete('SUCCESS');
            await event.getBuildOf('a').complete('SUCCESS');
            await event.getBuildOf('stage@red:setup').complete('SUCCESS');
            await event.getBuildOf('b').complete('SUCCESS');
            await event.getBuildOf('stage@red:teardown').complete('SUCCESS');

            assert.equal(event.getBuildOf('target').status, 'RUNNING');
        });

        it('[ ~stage@red, ~stage@blue ] is triggered', async () => {
            const pipeline = await pipelineFactoryMock.createFromFile('~stage@red_~stage@blue.yaml');

            const event = await eventFactoryMock.create({
                pipelineId: pipeline.id,
                startFrom: 'hub'
            });

            await event.getBuildOf('hub').complete('SUCCESS');
            await event.getBuildOf('a').complete('SUCCESS');
            await event.getBuildOf('stage@red:setup').complete('SUCCESS');
            await event.getBuildOf('stage@blue:setup').complete('SUCCESS');
            await event.getBuildOf('b').complete('SUCCESS');
            await event.getBuildOf('c').complete('SUCCESS');
            await event.getBuildOf('stage@red:teardown').complete('SUCCESS');
            await event.getBuildOf('stage@blue:teardown').complete('SUCCESS');

            assert.equal(event.getBuildOf('target').status, 'RUNNING');
        });
    });

    describe('virtual job', () => {
        const assertVirtualBuildSuccess = build => {
            assert.equal(build.status, 'SUCCESS');
            assert.equal(build.statusMessage, BUILD_STATUS_MESSAGES.SKIP_VIRTUAL_JOB.statusMessage);
            assert.equal(build.statusMessageType, BUILD_STATUS_MESSAGES.SKIP_VIRTUAL_JOB.statusMessageType);
        };

        it('skip execution of virtual jobs', async () => {
            const pipeline = await pipelineFactoryMock.createFromFile('virtual-jobs.yaml');

            const event = await eventFactoryMock.create({
                pipelineId: pipeline.id,
                startFrom: 'hub'
            });

            await event.getBuildOf('hub').complete('SUCCESS');
            assert.equal(event.getBuildOf('a').status, 'RUNNING');
            assert.equal(event.getBuildOf('b').status, 'RUNNING');
            assert.equal(event.getBuildOf('c').status, 'RUNNING');

            await event.getBuildOf('a').complete('SUCCESS');
            assertVirtualBuildSuccess(event.getBuildOf('d1'));
            assertVirtualBuildSuccess(event.getBuildOf('d2'));
            assertVirtualBuildSuccess(event.getBuildOf('d3'));
            assertVirtualBuildSuccess(event.getBuildOf('d4'));

            assert.equal(event.getBuildOf('d5').status, 'CREATED');
            assert.equal(event.getBuildOf('d6').status, 'CREATED');
            assert.equal(event.getBuildOf('d7').status, 'CREATED');
            assertVirtualBuildSuccess(event.getBuildOf('target1'));
            assert.equal(event.getBuildOf('target2').status, 'RUNNING');

            await event.getBuildOf('b').complete('SUCCESS');
            assertVirtualBuildSuccess(event.getBuildOf('d5'));
            assertVirtualBuildSuccess(event.getBuildOf('d6'));
            assert.equal(event.getBuildOf('d7').status, 'CREATED');

            await event.getBuildOf('c').complete('SUCCESS');
            assertVirtualBuildSuccess(event.getBuildOf('d7'));
        });

        it('skip execution of virtual jobs when triggered from external', async () => {
            const upstreamPipeline = await pipelineFactoryMock.createFromFile('virtual-jobs-upstream.yaml');
            const downstreamPipeline = await pipelineFactoryMock.createFromFile('virtual-jobs-downstream.yaml');

            const upstreamEvent = await eventFactoryMock.create({
                pipelineId: upstreamPipeline.id,
                startFrom: 'hub'
            });

            await upstreamEvent.getBuildOf('hub').complete('SUCCESS');
            await upstreamEvent.getBuildOf('a').complete('SUCCESS');

            const downstreamEvent = downstreamPipeline.getLatestEvent();

            assertVirtualBuildSuccess(downstreamEvent.getBuildOf('b'));
            assertVirtualBuildSuccess(downstreamEvent.getBuildOf('c'));
            assertVirtualBuildSuccess(upstreamEvent.getBuildOf('d'));
            assertVirtualBuildSuccess(upstreamEvent.getBuildOf('e'));
        });

        it('should add virtual jobs to execution queue when they have freeze windows', async () => {
            const pipeline = await pipelineFactoryMock.createFromFile('virtual-jobs-with-freeze-windows.yaml');

            const event = await eventFactoryMock.create({
                pipelineId: pipeline.id,
                startFrom: 'hub'
            });

            await event.getBuildOf('hub').complete('SUCCESS');
            assert.equal(event.getBuildOf('a').status, 'RUNNING');
            assert.equal(event.getBuildOf('b').status, 'RUNNING');
            assert.equal(event.getBuildOf('c').status, 'RUNNING');

            await event.getBuildOf('a').complete('SUCCESS');
            assert.equal(event.getBuildOf('d1').status, 'RUNNING');
            assert.equal(event.getBuildOf('d2').status, 'RUNNING');
            assert.equal(event.getBuildOf('d3').status, 'RUNNING');
            assert.equal(event.getBuildOf('d4').status, 'RUNNING');
            assert.equal(event.getBuildOf('d5').status, 'CREATED');
            assert.equal(event.getBuildOf('d6').status, 'CREATED');
            assert.equal(event.getBuildOf('d7').status, 'CREATED');

            await event.getBuildOf('d1').complete('SUCCESS');
            assert.equal(event.getBuildOf('target1').status, 'RUNNING');
            assert.equal(event.getBuildOf('target2').status, 'RUNNING');

            await event.getBuildOf('b').complete('SUCCESS');
            assert.equal(event.getBuildOf('d5').status, 'RUNNING');
            assert.equal(event.getBuildOf('d6').status, 'RUNNING');
            assert.equal(event.getBuildOf('d7').status, 'CREATED');

            await event.getBuildOf('c').complete('SUCCESS');
            assert.equal(event.getBuildOf('d7').status, 'RUNNING');
        });
    });
});
