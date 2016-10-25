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
                parseUrl: sinon.stub()
            }
        };
        userFactoryMock = {
            get: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../../plugins/webhooks');
        /* eslint-enable global-require */

        server = new hapi.Server();
        server.app = {
            jobFactory: jobFactoryMock,
            buildFactory: buildFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock
        };
        server.connection({
            host: 'localhost',
            port: 12345,
            uri: apiUri
        });

        server.register([{
            register: plugin,
            options: {
                secret: 'secretssecretsarenofun'
            }
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

    describe('POST /webhooks/github', () => {
        const checkoutUrl = 'git@github.com:baxterthehacker/public-repo.git#master';
        const scmUri = 'github.com:123456:master';
        const pipelineId = 'pipelineHash';
        const jobId = 'jobHash';
        const buildId = 'buildHash';
        const buildNumber = '12345';
        const sha = '0d1a26e67d8f5eaf1f6ba5c57fc3c7d91ac0fd1c';
        const username = 'baxterthehacker';
        const token = 'iamtoken';
        let name = 'PR-1';
        let pipelineMock;
        let buildMock;
        let jobMock;
        let userMock;
        let options;

        beforeEach(() => {
            pipelineMock = {
                id: pipelineId,
                scmUri,
                admins: {
                    baxterthehacker: false
                },
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

            it('returns 204 when pipeline does not exist', () => {
                pipelineFactoryMock.get.resolves(null);
                options.payload = testPayloadOpen;

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 204);
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

                    options.payload = testPayloadSync;
                    jobFactoryMock.get.withArgs(jobId).resolves(jobMock);
                    jobMock.getRunningBuilds.resolves([model1, model2]);
                });

                it('returns 201 on success', () =>
                    server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(pipelineMock.getConfiguration,
                            'pull/1/merge');
                        assert.calledWith(buildFactoryMock.create, {
                            jobId,
                            username,
                            sha
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
                            sha
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

                    options.payload = testPayloadClose;
                    jobFactoryMock.get.withArgs(jobId).resolves(jobMock);
                    jobMock.getRunningBuilds.resolves([model1, model2]);
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
