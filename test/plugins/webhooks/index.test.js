'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');

const testPayloadPush = require('../data/github.push.json');
const testPayloadOpen = require('../data/github.pull_request.opened.json');
const testPayloadSync = require('../data/github.pull_request.synchronize.json');
const testPayloadClose = require('../data/github.pull_request.closed.json');
const testPayloadOther = require('../data/github.pull_request.labeled.json');

const PARSED_CONFIG = require('../data/github.parsedyaml.json');

sinon.assert.expose(assert, { prefix: '' });

require('sinon-as-promised');

describe('github plugin test', () => {
    let jobFactoryMock;
    let buildFactoryMock;
    let pipelineFactoryMock;
    let userFactoryMock;
    let eventFactoryMock;
    let plugin;
    let server;
    const apiUri = 'http://foo.bar:12345';

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        jobFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub(),
            generateId: sinon.stub()
        };
        buildFactoryMock = {
            create: sinon.stub()
        };
        pipelineFactoryMock = {
            get: sinon.stub(),
            scm: {
                parseHook: sinon.stub(),
                parseUrl: sinon.stub()
            }
        };
        userFactoryMock = {
            get: sinon.stub()
        };
        eventFactoryMock = {
            create: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../../plugins/webhooks');
        /* eslint-enable global-require */

        server = new hapi.Server();
        server.root.app = {
            jobFactory: jobFactoryMock,
            buildFactory: buildFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock,
            eventFactory: eventFactoryMock
        };
        server.connection({
            host: 'localhost',
            port: 12345,
            uri: apiUri
        });

        server.register([{
            register: plugin
        }], (err) => {
            server.app.buildFactory.apiUri = apiUri;
            server.app.buildFactory.tokenGen = buildId =>
                JSON.stringify({
                    username: buildId,
                    scope: ['build']
                });
            done(err);
        });
    });

    afterEach(() => {
        server = null;
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    it('registers the plugin', () => {
        assert.isOk(server.registrations.webhooks);
        assert.equal(server.app.buildFactory.tokenGen('12345'),
            '{"username":"12345","scope":["build"]}');
    });

    describe('POST /webhooks', () => {
        const checkoutUrl = 'git@github.com:baxterthehacker/public-repo.git#master';
        const scmUri = 'github.com:123456:master';
        const pipelineId = 'pipelineHash';
        const jobId = 'jobHash';
        const buildId = 'buildHash';
        const buildNumber = '12345';
        const sha = '0d1a26e67d8f5eaf1f6ba5c57fc3c7d91ac0fd1c';
        const username = 'baxterthehacker';
        const token = 'iamtoken';
        const parsed = {
            hookId: '81e6bd80-9a2c-11e6-939d-beaa5d9adaf3',
            username,
            checkoutUrl,
            branch: 'master',
            sha,
            prNum: 1,
            prRef: 'pull/1/merge'
        };
        let name = 'PR-1';
        let pipelineMock;
        let buildMock;
        let jobMock;
        let userMock;
        let eventMock;
        let options;
        let reqHeaders;
        let payload;

        beforeEach(() => {
            pipelineMock = {
                id: pipelineId,
                scmUri,
                admins: {
                    baxterthehacker: false
                },
                workflow: ['main'],
                sync: sinon.stub(),
                getConfiguration: sinon.stub()
            };
            buildMock = {
                id: buildId,
                number: buildNumber,
                isDone: sinon.stub(),
                update: sinon.stub()
            };
            jobMock = {
                id: jobId,
                name,
                state: 'ENABLED',
                update: sinon.stub(),
                getRunningBuilds: sinon.stub()
            };
            userMock = {
                unsealToken: sinon.stub()
            };
            eventMock = {
                id: 'bbf22a3808c19dc50777258a253805b14fb3ad8b'
            };

            buildFactoryMock.create.resolves(buildMock);
            buildMock.update.resolves(null);

            jobFactoryMock.generateId.withArgs({ pipelineId, name }).returns(jobId);
            jobFactoryMock.create.resolves(jobMock);
            jobFactoryMock.get.resolves(jobMock);
            jobMock.update.resolves(jobMock);

            pipelineFactoryMock.get.resolves(pipelineMock);
            pipelineMock.sync.resolves({});
            pipelineMock.getConfiguration.resolves(PARSED_CONFIG);
            pipelineFactoryMock.scm.parseUrl.withArgs({ checkoutUrl, token }).resolves(scmUri);

            userFactoryMock.get.resolves(userMock);
            userMock.unsealToken.resolves(token);

            eventFactoryMock.create.resolves(eventMock);
        });

        it('returns 204 for unsupported event type', () => {
            reqHeaders = {
                'x-github-event': 'notSupported',
                'x-github-delivery': 'bar',
                'user-agent': 'shot',
                host: 'localhost:12345',
                'content-type': 'application/json',
                'content-length': '2'
            };
            pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, {}).resolves(null);

            options = {
                method: 'POST',
                url: '/webhooks',
                headers: {
                    'x-github-event': 'notSupported',
                    'x-github-delivery': 'bar'
                },
                credentials: {},
                payload: {}
            };

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 204);
            });
        });

        describe('push event', () => {
            beforeEach(() => {
                parsed.type = 'repo';
                parsed.action = 'push';
                reqHeaders = {
                    'x-github-event': 'push',
                    'x-github-delivery': parsed.hookId,
                    'user-agent': 'shot',
                    host: 'localhost:12345',
                    'content-type': 'application/json',
                    'content-length': '6632'
                };
                payload = testPayloadPush;
                options = {
                    method: 'POST',
                    url: '/webhooks',
                    headers: {
                        'x-github-event': 'push',
                        'x-github-delivery': parsed.hookId
                    },
                    payload,
                    credentials: {}
                };
                name = 'main';
                jobFactoryMock.generateId.withArgs({ pipelineId, name }).returns(jobId);
                pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, payload).resolves(parsed);
            });

            it('returns 201 on success', () =>
                server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 201);
                    assert.calledOnce(pipelineMock.sync);
                    assert.calledWith(eventFactoryMock.create, {
                        pipelineId,
                        type: 'pipeline',
                        workflow: [name],
                        username,
                        sha,
                        causeMessage: `Merged by ${username}`
                    });
                    assert.calledWith(buildFactoryMock.create, {
                        jobId,
                        username,
                        sha,
                        eventId: eventMock.id
                    });
                })
            );

            it('returns 204 when no pipeline', () => {
                pipelineFactoryMock.get.resolves(null);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 204);
                });
            });

            it('returns 500 when failed', () => {
                buildFactoryMock.create.rejects(new Error('Failed to start'));

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 500);
                });
            });

            it('handles checkouting when given a non-listed user', () => {
                userFactoryMock.get.resolves(null);
                userFactoryMock.get.withArgs({ username: 'sd-buildbot' }).resolves(userMock);

                return server.inject(options)
                .then((response) => {
                    assert.equal(response.statusCode, 201);
                });
            });
        });

        describe('pull-request event', () => {
            beforeEach(() => {
                parsed.type = 'pr';
                parsed.action = 'opened';
                reqHeaders = {
                    'x-github-event': 'pull_request',
                    'x-github-delivery': parsed.hookId,
                    'user-agent': 'shot',
                    host: 'localhost:12345',
                    'content-type': 'application/json',
                    'content-length': '21236'
                };
                payload = testPayloadOpen;
                options = {
                    method: 'POST',
                    url: '/webhooks',
                    headers: {
                        'x-github-event': 'pull_request',
                        'x-github-delivery': parsed.hookId
                    },
                    credentials: {},
                    payload
                };
                name = 'PR-1';
            });

            it('returns 204 when pipeline does not exist', () => {
                pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, payload).resolves(parsed);
                pipelineFactoryMock.get.resolves(null);
                options.payload = testPayloadOpen;

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 204);
                });
            });

            it('returns 500 when pipeline model returns error', () => {
                pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, payload).resolves(parsed);
                pipelineFactoryMock.get.rejects(new Error('model error'));
                options.payload = testPayloadOpen;

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 500);
                });
            });

            describe('open pull request', () => {
                beforeEach(() => {
                    parsed.action = 'opened';
                    options.payload = testPayloadOpen;
                    pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, options.payload)
                        .resolves(parsed);
                });

                it('returns 201 on success', () =>
                    server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 201);
                        assert.calledWith(pipelineMock.sync);
                        assert.calledWith(pipelineMock.getConfiguration,
                            'pull/1/merge');
                        assert.calledWith(jobFactoryMock.create, {
                            pipelineId,
                            name,
                            permutations: [{
                                commands: [
                                    { command: 'npm install', name: 'init' },
                                    { command: 'npm test', name: 'test' }
                                ],
                                environment: { NODE_ENV: 'test', NODE_VERSION: '4' },
                                image: 'node:4'
                            }, {
                                commands: [
                                    { command: 'npm install', name: 'init' },
                                    { command: 'npm test', name: 'test' }
                                ],
                                environment: { NODE_ENV: 'test', NODE_VERSION: '5' },
                                image: 'node:5'
                            }, {
                                commands: [
                                    { command: 'npm install', name: 'init' },
                                    { command: 'npm test', name: 'test' }
                                ],
                                environment: { NODE_ENV: 'test', NODE_VERSION: '6' },
                                image: 'node:6'
                            }]
                        });
                        assert.calledWith(eventFactoryMock.create, {
                            pipelineId,
                            type: 'pr',
                            workflow: [name],
                            username,
                            sha,
                            causeMessage: `Opened by ${username}`
                        });
                        assert.calledWith(buildFactoryMock.create, {
                            jobId,
                            sha,
                            username,
                            eventId: eventMock.id
                        });
                    })
                );

                it('returns 500 when failed', () => {
                    buildFactoryMock.create.rejects(new Error('Failed to start'));

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 500);
                        assert.calledWith(pipelineMock.sync);
                        assert.calledWith(jobFactoryMock.create, {
                            pipelineId,
                            name,
                            permutations: [{
                                commands: [
                                    { command: 'npm install', name: 'init' },
                                    { command: 'npm test', name: 'test' }
                                ],
                                environment: { NODE_ENV: 'test', NODE_VERSION: '4' },
                                image: 'node:4'
                            }, {
                                commands: [
                                    { command: 'npm install', name: 'init' },
                                    { command: 'npm test', name: 'test' }
                                ],
                                environment: { NODE_ENV: 'test', NODE_VERSION: '5' },
                                image: 'node:5'
                            }, {
                                commands: [
                                    { command: 'npm install', name: 'init' },
                                    { command: 'npm test', name: 'test' }
                                ],
                                environment: { NODE_ENV: 'test', NODE_VERSION: '6' },
                                image: 'node:6'
                            }]
                        });
                        assert.calledWith(buildFactoryMock.create, {
                            jobId,
                            sha,
                            username,
                            eventId: eventMock.id
                        });
                    });
                });

                it('handles checkout when given a non-listed user', () => {
                    userFactoryMock.get.resolves(null);
                    userFactoryMock.get.withArgs({ username: 'sd-buildbot' }).resolves(userMock);

                    return server.inject(options)
                    .then((response) => {
                        assert.equal(response.statusCode, 201);
                    });
                });
            });

            describe('synchronize pull request', () => {
                let model1;
                let model2;

                beforeEach(() => {
                    model1 = {
                        id: 1,
                        isDone: sinon.stub().returns(false),
                        update: sinon.stub().resolves(null)
                    };
                    model2 = {
                        id: 2,
                        isDone: sinon.stub().returns(false),
                        update: sinon.stub().resolves(null)
                    };

                    parsed.action = 'synchronized';
                    reqHeaders = {
                        'x-github-event': 'pull_request',
                        'x-github-delivery': parsed.hookId,
                        'user-agent': 'shot',
                        host: 'localhost:12345',
                        'content-type': 'application/json',
                        'content-length': '21241'
                    };
                    options.payload = testPayloadSync;
                    jobFactoryMock.get.withArgs(jobId).resolves(jobMock);
                    jobMock.getRunningBuilds.resolves([model1, model2]);
                    pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, options.payload)
                        .resolves(parsed);
                });

                it('returns 201 on success', () =>
                    server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(pipelineMock.getConfiguration,
                            'pull/1/merge');
                        assert.calledWith(eventFactoryMock.create, {
                            pipelineId,
                            type: 'pr',
                            workflow: [name],
                            username,
                            sha,
                            causeMessage: `Synchronized by ${username}`
                        });
                        assert.calledWith(buildFactoryMock.create, {
                            jobId,
                            username,
                            sha,
                            eventId: eventMock.id
                        });
                        assert.equal(reply.statusCode, 201);
                    })
                );

                it('has the workflow for stopping builds before starting a new one', () =>
                    server.inject(options).then((reply) => {
                        assert.calledOnce(model1.update);
                        assert.calledOnce(model2.update);
                        assert.calledOnce(buildFactoryMock.create);
                        assert.calledWith(buildFactoryMock.create, {
                            jobId,
                            username,
                            sha,
                            eventId: eventMock.id
                        });
                        assert.isOk(model1.update.calledBefore(buildFactoryMock.create));
                        assert.isOk(model2.update.calledBefore(buildFactoryMock.create));
                        assert.equal(reply.statusCode, 201);
                    })
                );

                it('does not update if build finished running', () => {
                    model2.isDone.returns(true);

                    return server.inject(options).then((reply) => {
                        assert.notCalled(model2.update);
                        assert.equal(reply.statusCode, 201);
                    });
                });

                it('returns 404 when job is missing', () => {
                    jobFactoryMock.get.withArgs(jobId).resolves(null);

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 404);
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(jobFactoryMock.generateId, { pipelineId, name });
                        assert.calledWith(jobFactoryMock.get, jobId);
                    });
                });

                it('returns 500 when failed', () => {
                    buildFactoryMock.create.rejects(new Error('Failed to start'));

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 500);
                    });
                });
            });

            describe('close pull request', () => {
                let model1;
                let model2;

                beforeEach(() => {
                    model1 = {
                        id: 1,
                        isDone: sinon.stub().returns(false),
                        update: sinon.stub().resolves(null)
                    };
                    model2 = {
                        id: 2,
                        isDone: sinon.stub().returns(false),
                        update: sinon.stub().resolves(null)
                    };

                    parsed.action = 'closed';
                    reqHeaders = {
                        'x-github-event': 'pull_request',
                        'x-github-delivery': parsed.hookId,
                        'user-agent': 'shot',
                        host: 'localhost:12345',
                        'content-type': 'application/json',
                        'content-length': '21236'
                    };
                    options.payload = testPayloadClose;
                    jobFactoryMock.get.withArgs(jobId).resolves(jobMock);
                    jobMock.getRunningBuilds.resolves([model1, model2]);
                    pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, options.payload)
                        .resolves(parsed);
                });

                it('returns 200 on success', () =>
                    server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 200);
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(jobFactoryMock.generateId, { pipelineId, name });
                        assert.calledWith(jobFactoryMock.get, jobId);
                        assert.calledOnce(jobMock.update);
                        assert.strictEqual(jobMock.state, 'DISABLED');
                        assert.isTrue(jobMock.archived);
                    })
                );

                it('stops running builds', () =>
                    server.inject(options).then(() => {
                        assert.calledOnce(model1.update);
                        assert.calledOnce(model2.update);
                    })
                );

                it('returns 500 when failed', () => {
                    jobMock.update.rejects(new Error('Failed to update'));

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 500);
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(jobFactoryMock.generateId, { pipelineId, name });
                        assert.calledWith(jobFactoryMock.get, jobId);
                        assert.calledOnce(jobMock.update);
                        assert.strictEqual(jobMock.state, 'DISABLED');
                    });
                });

                it('returns 404 when job is missing', () => {
                    jobFactoryMock.get.withArgs(jobId).resolves(null);

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 404);
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(jobFactoryMock.generateId, { pipelineId, name });
                        assert.calledWith(jobFactoryMock.get, jobId);
                    });
                });
            });

            describe('other change pull request', () => {
                it('returns 204 for unsupported event action', () => {
                    options.payload = testPayloadOther;
                    pipelineFactoryMock.scm.parseHook.resolves(null);

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 204);
                        assert.equal(pipelineMock.sync.callCount, 0);
                        assert.equal(pipelineFactoryMock.get.callCount, 0);
                        assert.equal(jobFactoryMock.generateId.callCount, 0);
                    });
                });
            });
        });

        describe('something went wrong with parseHook', () => {
            it('returns 500 when failed', () => {
                pipelineFactoryMock.scm.parseHook.rejects(new Error('Invalid x-hub-signature'));

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 500);
                });
            });
        });
    });
});
