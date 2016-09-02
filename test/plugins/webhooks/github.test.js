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

describe('github plugin test', () => {
    let jobFactoryMock;
    let buildFactoryMock;
    let pipelineFactoryMock;
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
            create: sinon.stub(),
            getBuildsForJobId: sinon.stub()
        };
        pipelineFactoryMock = {
            get: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../../plugins/webhooks');
        /* eslint-enable global-require */

        server = new hapi.Server();
        server.app = {
            jobFactory: jobFactoryMock,
            buildFactory: buildFactoryMock,
            pipelineFactory: pipelineFactoryMock
        };
        server.connection({
            host: 'localhost',
            port: 12345,
            uri: apiUri
        });

        server.register([{
            // eslint-disable-next-line global-require
            register: require('../../../plugins/auth'),
            options: {
                password: 'this_is_a_password_that_needs_to_be_atleast_32_characters',
                oauthClientId: '1234id5678',
                oauthClientSecret: '1234secretoauthything5678',
                jwtPrivateKey: 'supersecret',
                jwtPublicKey: 'lesssecret',
                https: true
            }
        },
        {
            register: plugin,
            options: {
                secret: 'secretssecretsarenofun'
            }
        }], (err) => {
            server.app.buildFactory.apiUri = apiUri;
            server.app.buildFactory.tokenGen = (buildId) =>
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

    describe('POST /webhooks/github', () => {
        const scmUrl = 'git@github.com:baxterthehacker/public-repo.git#master';
        const pipelineId = 'pipelineHash';
        const jobId = 'jobHash';
        const buildId = 'buildHash';
        const buildNumber = '12345';
        const sha = '0d1a26e67d8f5eaf1f6ba5c57fc3c7d91ac0fd1c';
        const username = 'baxterthehacker';
        let name = 'PR-1';
        let pipelineMock;
        let buildMock;
        let jobMock;
        let options;

        beforeEach(() => {
            pipelineMock = {
                id: pipelineId,
                scmUrl,
                admins: {
                    baxterthehacker: false
                },
                sync: sinon.stub(),
                getConfiguration: sinon.stub()
            };
            buildMock = {
                id: buildId,
                number: buildNumber,
                stop: sinon.stub()
            };
            jobMock = {
                id: jobId,
                name,
                state: 'ENABLED',
                update: sinon.stub()
            };

            buildFactoryMock.create.resolves(buildMock);
            buildFactoryMock.getBuildsForJobId.resolves([buildMock]);
            buildMock.stop.resolves(null);

            jobFactoryMock.generateId.withArgs({ pipelineId, name }).returns(jobId);
            jobFactoryMock.create.resolves(jobMock);
            jobFactoryMock.get.resolves(jobMock);
            jobMock.update.resolves(jobMock);

            pipelineFactoryMock.get.resolves(pipelineMock);
            pipelineMock.sync.resolves({});
            pipelineMock.getConfiguration.resolves(PARSED_CONFIG);
        });

        it('returns 400 for unsupported event type', () => {
            options = {
                method: 'POST',
                url: '/webhooks/github',
                headers: {
                    'x-github-event': 'notSupported',
                    'x-github-delivery': 'bar'
                },
                credentials: {}
            };

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 400);
            });
        });

        describe('ping event', () => {
            beforeEach(() => {
                options = {
                    method: 'POST',
                    url: '/webhooks/github',
                    headers: {
                        'x-github-event': 'ping',
                        'x-github-delivery': 'eventId'
                    },
                    payload: testPayloadOpen,
                    credentials: {}
                };
            });

            it('returns 204', () =>
                server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 204);
                })
            );
        });

        describe('push event', () => {
            beforeEach(() => {
                options = {
                    method: 'POST',
                    url: '/webhooks/github',
                    headers: {
                        'x-github-event': 'push',
                        'x-github-delivery': 'eventId'
                    },
                    payload: testPayloadPush,
                    credentials: {}
                };
                name = 'main';
                jobFactoryMock.generateId.withArgs({ pipelineId, name }).returns(jobId);
            });

            it('returns 201 on success', () => (
                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 201);
                    assert.calledOnce(pipelineMock.sync);
                    assert.calledWith(buildFactoryMock.create, {
                        jobId,
                        username,
                        sha
                    });
                })
            ));

            it('returns 404 when no pipeline', () => {
                pipelineFactoryMock.get.resolves(null);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 404);
                });
            });

            it('returns 500 when failed', () => {
                buildFactoryMock.create.rejects(new Error('Failed to start'));

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 500);
                });
            });
        });

        describe('pull-request event', () => {
            beforeEach(() => {
                options = {
                    method: 'POST',
                    url: '/webhooks/github',
                    headers: {
                        'x-github-event': 'pull_request',
                        'x-github-delivery': 'eventId'
                    },
                    credentials: {}
                };
                name = 'PR-1';
            });

            it('returns 404 when pipeline does not exist', () => {
                pipelineFactoryMock.get.resolves(null);
                options.payload = testPayloadOpen;

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 404);
                });
            });

            it('returns 500 when pipeline model returns error', () => {
                pipelineFactoryMock.get.rejects(new Error('model error'));
                options.payload = testPayloadOpen;

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 500);
                });
            });

            describe('open pull request', () => {
                beforeEach(() => {
                    options.payload = testPayloadOpen;
                });

                it('returns 201 on success', () =>
                    server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 201);
                        assert.calledWith(pipelineMock.sync);
                        assert.calledWith(pipelineMock.getConfiguration,
                            'git@github.com:baxterthehacker/public-repo.git#pull/1/merge');
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
                            username
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
                            username
                        });
                    });
                });
            });

            describe('synchronize pull request', () => {
                beforeEach(() => {
                    options.payload = testPayloadSync;
                });

                it('returns 201 on success', () => (
                    server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 201);
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledOnce(buildMock.stop);
                        assert.calledWith(buildFactoryMock.create, {
                            jobId,
                            username,
                            sha
                        });
                    })
                ));

                it('has the workflow for stopping builds before starting a new one', () => {
                    const model1 = { id: 1, stop: sinon.stub().resolves(null) };
                    const model2 = { id: 2, stop: sinon.stub().resolves(null) };

                    buildFactoryMock.getBuildsForJobId.withArgs({ jobId }).resolves(
                        [model1, model2]
                    );

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 201);
                        assert.calledOnce(model1.stop);
                        assert.calledOnce(model2.stop);
                        assert.calledOnce(buildFactoryMock.create);
                        assert.calledWith(buildFactoryMock.create, {
                            jobId,
                            username,
                            sha
                        });
                        assert.isOk(model1.stop.calledBefore(buildFactoryMock.create));
                        assert.isOk(model2.stop.calledBefore(buildFactoryMock.create));
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
                beforeEach(() => {
                    options.payload = testPayloadClose;
                });

                it('returns 200 on success', () => (
                    server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 200);
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(jobFactoryMock.generateId, { pipelineId, name });
                        assert.calledWith(jobFactoryMock.get, jobId);
                        assert.calledOnce(jobMock.update);
                        assert.strictEqual(jobMock.state, 'DISABLED');
                    })
                ));

                it('stops running builds', () => {
                    const model1 = { id: 1, stop: sinon.stub().resolves(null) };
                    const model2 = { id: 2, stop: sinon.stub().resolves(null) };

                    buildFactoryMock.getBuildsForJobId.withArgs({ jobId }).resolves(
                        [model1, model2]
                    );

                    return server.inject(options).then(() => {
                        assert.calledOnce(model1.stop);
                        assert.calledOnce(model2.stop);
                    });
                });

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
                    jobFactoryMock.get.resolves(null);

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 404);
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(jobFactoryMock.generateId, { pipelineId, name });
                        assert.calledWith(jobFactoryMock.get, jobId);
                    });
                });
            });

            describe('other change pull request', () => {
                beforeEach(() => {
                    options.payload = testPayloadOther;
                });

                it('returns 204 on success', () =>
                    server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 204);
                        assert.equal(pipelineMock.sync.callCount, 0);
                        assert.equal(pipelineFactoryMock.get.callCount, 0);
                        assert.equal(jobFactoryMock.generateId.callCount, 0);
                    })
                );
            });
        });
    });
});
