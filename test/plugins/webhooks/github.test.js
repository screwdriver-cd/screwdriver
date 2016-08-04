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

/**
 * Stub for PipelineModel factory method
 * @method pipelineModelFactoryMock
 */
function pipelineModelFactoryMock() {}

/**
 * Stub for JobModel factory method
 * @method jobModelFactoryMock
 */
function jobModelFactoryMock() {}

/**
 * Stub for BuildModel factory method
 * @method buildModelFactoryMock
 */
function buildModelFactoryMock() {}

describe('github plugin test', () => {
    let pipelineMock;
    let jobMock;
    let buildMock;
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
        pipelineMock = {
            get: sinon.stub(),
            sync: sinon.stub(),
            generateId: sinon.stub()
        };
        pipelineModelFactoryMock.prototype.get = pipelineMock.get;
        pipelineModelFactoryMock.prototype.sync = pipelineMock.sync;
        pipelineModelFactoryMock.prototype.generateId = pipelineMock.generateId;
        jobMock = {
            update: sinon.stub(),
            create: sinon.stub(),
            generateId: sinon.stub()
        };
        jobModelFactoryMock.prototype.update = jobMock.update;
        jobModelFactoryMock.prototype.create = jobMock.create;
        jobModelFactoryMock.prototype.generateId = jobMock.generateId;
        buildMock = {
            create: sinon.stub(),
            getBuildsForJobId: sinon.stub()
        };
        buildModelFactoryMock.prototype.create = buildMock.create;
        buildModelFactoryMock.prototype.getBuildsForJobId = buildMock.getBuildsForJobId;

        mockery.registerMock('screwdriver-models', {
            Pipeline: pipelineModelFactoryMock,
            Build: buildModelFactoryMock,
            Job: jobModelFactoryMock
        });
        mockery.registerMock('./credentials', {
            generateProfile: (username, scope) => ({ username, scope }),
            generateToken: (profile, token) => JSON.stringify(profile) + JSON.stringify(token)
        });

        /* eslint-disable global-require */
        plugin = require('../../../plugins/webhooks');
        /* eslint-enable global-require */

        server = new hapi.Server({
            app: {
                datastore: {},
                executor: {}
            }
        });
        server.connection({
            host: 'localhost',
            port: 12345
        });
        apiUri = 'http://localhost:12345';

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
        it('returns 400 for unsupported event type', (done) => {
            const options = {
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
            let options;

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
            let options;

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

            describe('open pull request', () => {
                it('returns 201 on success', (done) => {
                    const scmUrl = 'git@github.com:baxterthehacker/public-repo.git#master';
                    const pipelineId = 'pipelineHash';
                    const jobId = 'jobHash';
                    const buildId = 'buildHash';
                    const name = 'PR-1';
                    const buildNumber = '12345';
                    const sha = '0d1a26e67d8f5eaf1f6ba5c57fc3c7d91ac0fd1c';
                    const username = 'baxterthehacker';

                    options.payload = testPayloadOpen;

                    buildMock.create.yieldsAsync(null, {
                        id: buildId,
                        number: buildNumber
                    });
                    jobMock.generateId.returns(jobId);
                    jobMock.create.yieldsAsync(null, { name });
                    pipelineMock.generateId.returns(pipelineId);
                    pipelineMock.get.yieldsAsync(null, {
                        admins: {
                            baxterthehacker: false
                        }
                    });
                    pipelineMock.sync.yieldsAsync(null, {});

                    server.inject(options, (reply) => {
                        assert.equal(reply.statusCode, 201);
                        assert.calledWith(pipelineMock.get, pipelineId);
                        assert.calledWith(pipelineMock.sync, { scmUrl });
                        assert.calledWith(pipelineMock.generateId, { scmUrl });
                        assert.calledWith(jobMock.create, { pipelineId, name });
                        assert.calledWith(jobMock.generateId, { pipelineId, name });
                        assert.calledWith(buildMock.create, {
                            jobId,
                            sha,
                            apiUri,
                            username,
                            tokenGen: sinon.match.func
                        });
                        assert.equal(buildMock.create.getCall(0).args[0].tokenGen('12345'),
                            '{"username":"12345","scope":["build"]}"supersecret"');
                        done();
                    });
                });

                it('returns 500 when failed', (done) => {
                    const scmUrl = 'git@github.com:baxterthehacker/public-repo.git#master';
                    const pipelineId = 'pipelineHash';
                    const jobId = 'jobHash';
                    const name = 'PR-1';
                    const sha = '0d1a26e67d8f5eaf1f6ba5c57fc3c7d91ac0fd1c';
                    const username = 'baxterthehacker';

                    options.payload = testPayloadOpen;

                    buildMock.create.yieldsAsync(new Error('Failed to start'));
                    jobMock.generateId.returns(jobId);
                    jobMock.create.yieldsAsync(null, { name });
                    pipelineMock.generateId.returns(pipelineId);
                    pipelineMock.get.yieldsAsync(null, {
                        admins: {
                            baxterthehacker: false
                        }
                    });
                    pipelineMock.sync.yieldsAsync(null, {});

                    server.inject(options, (reply) => {
                        assert.equal(reply.statusCode, 500);
                        assert.calledWith(pipelineMock.get, pipelineId);
                        assert.calledWith(pipelineMock.sync, { scmUrl });
                        assert.calledWith(pipelineMock.generateId, { scmUrl });
                        assert.calledWith(jobMock.create, { pipelineId, name });
                        assert.calledWith(jobMock.generateId, { pipelineId, name });
                        assert.calledWith(buildMock.create, {
                            jobId,
                            sha,
                            apiUri,
                            username,
                            tokenGen: sinon.match.func
                        });
                        assert.equal(buildMock.create.getCall(0).args[0].tokenGen('12345'),
                            '{"username":"12345","scope":["build"]}"supersecret"');
                        done();
                    });
                });
            });

            describe('synchronize pull request', () => {
                const scmUrl = 'git@github.com:baxterthehacker/public-repo.git#master';
                const pipelineId = 'pipelineHash';
                const jobId = 'jobHash';
                const name = 'PR-1';

                beforeEach(() => {
                    jobMock.generateId.returns(jobId);
                    pipelineMock.generateId.returns(pipelineId);
                    pipelineMock.sync.yieldsAsync(null, {});

                    options.payload = testPayloadSync;
                });

                it('returns 201 on success', (done) => {
                    buildMock.getBuildsForJobId.yieldsAsync(null, ['main']);
                    buildMock.create.yieldsAsync(null, { id: jobId });

                    server.inject(options, (reply) => {
                        assert.equal(reply.statusCode, 201);
                        assert.calledWith(pipelineMock.sync, { scmUrl });
                        assert.calledWith(pipelineMock.generateId, { scmUrl });
                        assert.calledWith(jobMock.generateId, { pipelineId, name });
                        assert.calledWith(buildMock.create, { jobId });
                        done();
                    });
                });

                it('has the workflow for stopping builds before starting a new one', (done) => {
                    buildMock.getBuildsForJobId.yieldsAsync(null, ['main']);
                    buildMock.create.yieldsAsync(null, { id: jobId });

                    server.inject(options, (reply) => {
                        assert.equal(reply.statusCode, 201);
                        assert.isOk(buildMock.getBuildsForJobId.calledBefore(buildMock.create));
                        done();
                    });
                });

                it('returns 500 when failed', (done) => {
                    buildMock.getBuildsForJobId.yieldsAsync(null, ['main']);
                    buildMock.create.yieldsAsync(new Error('Failed to start'));

                    server.inject(options, (reply) => {
                        assert.equal(reply.statusCode, 500);
                        done();
                    });
                });
            });

            describe('close pull request', () => {
                it('returns 200 on success', (done) => {
                    const scmUrl = 'git@github.com:baxterthehacker/public-repo.git#master';
                    const pipelineId = 'pipelineHash';
                    const jobId = 'jobHash';
                    const name = 'PR-1';

                    options.payload = testPayloadClose;

                    jobMock.generateId.returns(jobId);
                    jobMock.update.yieldsAsync(null, {});
                    pipelineMock.generateId.returns(pipelineId);
                    pipelineMock.sync.yieldsAsync(null, {});

                    server.inject(options, (reply) => {
                        assert.equal(reply.statusCode, 200);
                        assert.calledWith(pipelineMock.sync, { scmUrl });
                        assert.calledWith(pipelineMock.generateId, { scmUrl });
                        assert.calledWith(jobMock.update, {
                            id: jobId,
                            data: {
                                state: 'DISABLED'
                            }
                        });
                        assert.calledWith(jobMock.generateId, { pipelineId, name });
                        done();
                    });
                });

                it('returns 500 when failed', (done) => {
                    const scmUrl = 'git@github.com:baxterthehacker/public-repo.git#master';
                    const pipelineId = 'pipelineHash';
                    const jobId = 'jobHash';
                    const name = 'PR-1';

                    options.payload = testPayloadClose;

                    jobMock.generateId.returns(jobId);
                    jobMock.update.yieldsAsync(new Error('Failed to update'), {});
                    pipelineMock.generateId.returns(pipelineId);
                    pipelineMock.sync.yieldsAsync(null, {});

                    server.inject(options, (reply) => {
                        assert.equal(reply.statusCode, 500);
                        assert.calledWith(pipelineMock.sync, { scmUrl });
                        assert.calledWith(pipelineMock.generateId, { scmUrl });
                        assert.calledWith(jobMock.update, {
                            id: jobId,
                            data: {
                                state: 'DISABLED'
                            }
                        });
                        assert.calledWith(jobMock.generateId, { pipelineId, name });
                        done();
                    });
                });
            });

            describe('other change pull request', () => {
                it('returns 204 on success', (done) => {
                    const scmUrl = 'git@github.com:baxterthehacker/public-repo.git#master';
                    const pipelineId = 'pipelineHash';
                    const jobId = 'jobHash';
                    const name = 'PR-1';

                    options.payload = testPayloadOther;

                    jobMock.generateId.returns(jobId);
                    pipelineMock.generateId.returns(pipelineId);
                    pipelineMock.sync.yieldsAsync(null, {});

                    server.inject(options, (reply) => {
                        assert.equal(reply.statusCode, 204);
                        assert.calledWith(pipelineMock.sync, { scmUrl });
                        assert.calledWith(pipelineMock.generateId, { scmUrl });
                        assert.calledWith(jobMock.generateId, { pipelineId, name });
                        done();
                    });
                });
            });

            it('returns 404 when pipeline does not exist', (done) => {
                pipelineMock.sync.yieldsAsync(null, null);
                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 404);
                    done();
                });
            });

            it('returns 500 when pipeline model returns error', (done) => {
                pipelineMock.sync.yieldsAsync(new Error('model error'));
                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 500);
                    done();
                });
            });
        });
    });
});
