'use strict';
const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');

const testPayloadOpen = require('../data/github.pull_request.opened.json');
const testPayloadSync = require('../data/github.pull_request.synchronize.json');
const testPayloadClose = require('../data/github.pull_request.closed.json');
const testPayloadOther = require('../data/github.pull_request.labeled.json');

sinon.assert.expose(assert, { prefix: '' });

describe('github plugin test', () => {
    let jobFactoryMock;
    let buildFactoryMock;
    let pipelineFactoryMock;
    let plugin;
    let server;
    let apiUri;

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

        mockery.registerMock('./credentials', {
            generateProfile: (username, scope) => ({ username, scope }),
            generateToken: (profile, token) => JSON.stringify(profile) + JSON.stringify(token)
        });

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
            port: 12345
        });
        apiUri = 'http://foo.bar:12345';

        server.register([{
            // eslint-disable-next-line global-require
            register: require('../../../plugins/login'),
            options: {
                password: 'this_is_a_password_that_needs_to_be_atleast_32_characters',
                oauthClientId: '1234id5678',
                oauthClientSecret: '1234secretoauthything5678',
                jwtPrivateKey: 'supersecret',
                https: true
            }
        },
        {
            register: plugin,
            options: {
                apiUri,
                secret: 'secretssecretsarenofun'
            }
        }], (err) => {
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
    });

    describe('POST /webhooks/github', () => {
        const scmUrl = 'git@github.com:baxterthehacker/public-repo.git#master';
        const pipelineId = 'pipelineHash';
        const jobId = 'jobHash';
        const buildId = 'buildHash';
        const name = 'PR-1';
        const buildNumber = '12345';
        const sha = '0d1a26e67d8f5eaf1f6ba5c57fc3c7d91ac0fd1c';
        const username = 'baxterthehacker';
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
                sync: sinon.stub()
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
        });

        it('returns 400 for unsupported event type', (done) => {
            options = {
                method: 'POST',
                url: '/webhooks/github',
                headers: {
                    'x-github-event': 'notSupported',
                    'x-github-delivery': 'bar'
                },
                credentials: {}
            };

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 400);
                done();
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

            it('returns 204', (done) => {
                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 204);
                    done();
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
            });

            it('returns 404 when pipeline does not exist', (done) => {
                pipelineFactoryMock.get.resolves(null);

                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 404);
                    done();
                });
            });

            it('returns 500 when pipeline model returns error', (done) => {
                pipelineFactoryMock.get.rejects(new Error('model error'));

                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 500);
                    done();
                });
            });

            describe('open pull request', () => {
                beforeEach(() => {
                    options.payload = testPayloadOpen;
                });

                it('returns 201 on success', (done) => {
                    server.inject(options, (reply) => {
                        assert.equal(reply.statusCode, 201);
                        assert.calledWith(pipelineMock.sync);
                        assert.calledWith(jobFactoryMock.create, { pipelineId, name });
                        assert.calledWith(buildFactoryMock.create, {
                            jobId,
                            sha,
                            apiUri,
                            username,
                            tokenGen: sinon.match.func
                        });
                        assert.equal(buildFactoryMock.create.getCall(0).args[0].tokenGen('12345'),
                            '{"username":"12345","scope":["build"]}"supersecret"');
                        done();
                    });
                });

                it('returns 500 when failed', (done) => {
                    buildFactoryMock.create.rejects(new Error('Failed to start'));

                    server.inject(options, (reply) => {
                        assert.equal(reply.statusCode, 500);
                        assert.calledWith(pipelineMock.sync);
                        assert.calledWith(jobFactoryMock.create, { pipelineId, name });
                        assert.calledWith(buildFactoryMock.create, {
                            jobId,
                            sha,
                            apiUri,
                            username,
                            tokenGen: sinon.match.func
                        });
                        assert.equal(buildFactoryMock.create.getCall(0).args[0].tokenGen('12345'),
                            '{"username":"12345","scope":["build"]}"supersecret"');
                        done();
                    });
                });
            });

            describe('synchronize pull request', () => {
                beforeEach(() => {
                    options.payload = testPayloadSync;
                });

                it('returns 201 on success', (done) => {
                    server.inject(options, (reply) => {
                        assert.equal(reply.statusCode, 201);
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledOnce(buildMock.stop);
                        assert.calledWith(buildFactoryMock.create, { jobId, username });
                        done();
                    });
                });

                it('has the workflow for stopping builds before starting a new one', (done) => {
                    const model1 = { id: 1, stop: sinon.stub().resolves(null) };
                    const model2 = { id: 2, stop: sinon.stub().resolves(null) };

                    buildFactoryMock.getBuildsForJobId.withArgs({ jobId }).resolves(
                        [model1, model2]
                    );

                    server.inject(options, (reply) => {
                        assert.equal(reply.statusCode, 201);
                        assert.calledOnce(model1.stop);
                        assert.calledOnce(model2.stop);
                        assert.calledOnce(buildFactoryMock.create);
                        assert.calledWith(buildFactoryMock.create, { jobId, username });
                        assert.isOk(model1.stop.calledBefore(buildFactoryMock.create));
                        assert.isOk(model2.stop.calledBefore(buildFactoryMock.create));
                        done();
                    });
                });

                it('returns 500 when failed', (done) => {
                    buildFactoryMock.create.rejects(new Error('Failed to start'));

                    server.inject(options, (reply) => {
                        assert.equal(reply.statusCode, 500);
                        done();
                    });
                });
            });

            describe('close pull request', () => {
                beforeEach(() => {
                    options.payload = testPayloadClose;
                });

                it('returns 200 on success', (done) => {
                    server.inject(options, (reply) => {
                        assert.equal(reply.statusCode, 200);
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(jobFactoryMock.generateId, { pipelineId, name });
                        assert.calledWith(jobFactoryMock.get, jobId);
                        assert.calledOnce(jobMock.update);
                        assert.strictEqual(jobMock.state, 'DISABLED');
                        done();
                    });
                });

                it('stops running builds', (done) => {
                    const model1 = { id: 1, stop: sinon.stub().resolves(null) };
                    const model2 = { id: 2, stop: sinon.stub().resolves(null) };

                    buildFactoryMock.getBuildsForJobId.withArgs({ jobId }).resolves(
                        [model1, model2]
                    );

                    server.inject(options, () => {
                        assert.calledOnce(model1.stop);
                        assert.calledOnce(model2.stop);
                        done();
                    });
                });

                it('returns 500 when failed', (done) => {
                    jobMock.update.rejects(new Error('Failed to update'));

                    server.inject(options, (reply) => {
                        assert.equal(reply.statusCode, 500);
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(jobFactoryMock.generateId, { pipelineId, name });
                        assert.calledWith(jobFactoryMock.get, jobId);
                        assert.calledOnce(jobMock.update);
                        assert.strictEqual(jobMock.state, 'DISABLED');
                        done();
                    });
                });
            });

            describe('other change pull request', () => {
                beforeEach(() => {
                    options.payload = testPayloadOther;
                });

                it('returns 204 on success', (done) => {
                    server.inject(options, (reply) => {
                        assert.equal(reply.statusCode, 204);
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(pipelineFactoryMock.get, { scmUrl });
                        assert.calledWith(jobFactoryMock.generateId, { pipelineId, name });
                        done();
                    });
                });
            });
        });
    });
});
