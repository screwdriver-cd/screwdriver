'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const urlLib = require('url');
const hoek = require('hoek');
const nock = require('nock');
const streamToPromise = require('stream-to-promise');
const FormData = require('form-data');
const testcommand = require('./data/command.json');
const testcommands = require('./data/commands.json');
const testcommandVersions = require('./data/commandVersions.json');
const testcommandTags = require('./data/commandTags.json');
const testBinaryCommand = require('./data/binaryCommand.json');
const testpipeline = require('./data/pipeline.json');
const COMMAND_INVALID = require('./data/command-validator.missing-version.json');
const COMMAND_VALID = require('./data/command-validator.input.json');
const COMMAND_VALID_NEW_VERSION = require('./data/command-create.input.json');
const COMMAND_DESCRIPTION = [
    'Command for habitat git',
    'Executes git commands\n'
].join('\n');
const BINARY_COMMAND_VALID = require('./data/binary-command-validator.input.json').yaml;
const BINARY_COMMAND_INVALID = require('./data/binary-command-validator.missing-version.json').yaml;
const BINARY_COMMAND_VALID_NEW_VERSION = require('./data/binary-command-create.input.json').yaml;
const COMMAND_BINARY = [
    '#!/bin/sh',
    'echo "FooBar!"\n'
].join('\n');

sinon.assert.expose(assert, { prefix: '' });

const decorateObj = (obj) => {
    const mock = hoek.clone(obj);

    mock.toJson = sinon.stub().returns(obj);

    return mock;
};

const getCommandMocks = (commands) => {
    if (Array.isArray(commands)) {
        return commands.map(decorateObj);
    }

    return decorateObj(commands);
};

const getPipelineMocks = (pipelines) => {
    if (Array.isArray(pipelines)) {
        return pipelines.map(decorateObj);
    }

    return decorateObj(pipelines);
};

const getUserMock = (user) => {
    const mock = hoek.clone(user);

    mock.getPermissions = sinon.stub();
    mock.toJson = sinon.stub().returns(user);

    return mock;
};

describe('command plugin test', () => {
    let commandFactoryMock;
    let commandTagFactoryMock;
    let pipelineFactoryMock;
    let userFactoryMock;
    let plugin;
    let server;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        commandFactoryMock = {
            create: sinon.stub(),
            list: sinon.stub(),
            getCommand: sinon.stub(),
            get: sinon.stub()
        };
        commandTagFactoryMock = {
            create: sinon.stub(),
            list: sinon.stub(),
            get: sinon.stub(),
            remove: sinon.stub()
        };
        pipelineFactoryMock = {
            get: sinon.stub()
        };
        userFactoryMock = {
            get: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/commands');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.app = {
            commandFactory: commandFactoryMock,
            commandTagFactory: commandTagFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock,
            ecosystem: {
                store: 'http://store.example.com'
            }
        };
        server.connection({
            port: 1234
        });

        server.auth.scheme('custom', () => ({
            authenticate: (request, reply) => reply.continue({
                credentials: {
                    scope: ['user']
                }
            })
        }));
        server.auth.strategy('token', 'custom');

        server.register([{
            register: plugin
        }], done);
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
        assert.isOk(server.registrations.commands);
    });

    describe('GET /commands', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/commands'
            };
        });

        it('returns 200 and all commands', () => {
            commandFactoryMock.list.resolves(getCommandMocks(testcommands));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, '200');
                assert.deepEqual(reply.result, testcommands);
                assert.calledWith(commandFactoryMock.list, {
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and all commands with namespace query', () => {
            commandFactoryMock.list.resolves(getCommandMocks(testcommands));
            options.url = '/commands?namespace=foo';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, '200');
                assert.deepEqual(reply.result, testcommands);
                assert.calledWith(commandFactoryMock.list, {
                    params: {
                        namespace: 'foo'
                    },
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and all namespaces using distinct query', () => {
            const namespaces = [
                { namespace: 'chef' },
                { namespace: 'docker' },
                { namespace: 'nodejs' },
                { namespace: 'screwdriver' },
                { namespace: 'tools' }
            ];

            commandFactoryMock.list.resolves(namespaces);
            options.url = '/commands?distinct=namespace';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, namespaces);
                assert.calledWith(commandFactoryMock.list, {
                    params: {
                        distinct: 'namespace'
                    },
                    sort: 'descending',
                    raw: true
                });
            });
        });

        it('returns 200 and all commands with sortBy query', () => {
            commandFactoryMock.list.resolves(getCommandMocks(testcommands));
            options.url = '/commands?sortBy=name';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testcommands);
                assert.calledWith(commandFactoryMock.list, {
                    sortBy: 'name',
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and all commands with search query', () => {
            commandFactoryMock.list.resolves(getCommandMocks(testcommands));
            options.url = '/commands?search=nodejs';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testcommands);
                assert.calledWith(commandFactoryMock.list, {
                    search: {
                        field: ['name', 'namespace', 'description'],
                        keyword: '%nodejs%'
                    },
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and all commands in compact format', () => {
            commandFactoryMock.list.resolves(getCommandMocks(testcommands));
            options.url = '/commands?compact=true';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testcommands);
                assert.calledWith(commandFactoryMock.list, {
                    exclude: ['usage', 'docker', 'habitat', 'binary'],
                    groupBy: ['namespace', 'name'],
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and all commands with search query without namespace field', () => {
            commandFactoryMock.list.resolves(getCommandMocks(testcommands));
            options.url = '/commands?search=nodejs&namespace=nodejs';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testcommands);
                assert.calledWith(commandFactoryMock.list, {
                    params: { namespace: 'nodejs' },
                    search: {
                        field: ['name', 'description'],
                        keyword: '%nodejs%'
                    },
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and all commands with pagination', () => {
            commandFactoryMock.list.resolves(getCommandMocks(testcommands));
            options.url = '/commands?count=30';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, '200');
                assert.deepEqual(reply.result, testcommands);
                assert.calledWith(commandFactoryMock.list, {
                    paginate: {
                        page: undefined,
                        count: 30
                    },
                    sort: 'descending'
                });
            });
        });

        it('returns 500 when datastore fails', () => {
            commandFactoryMock.list.rejects(new Error('fittoburst'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /commands/namespace/name/versionOrTag', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/commands/foo/bar/1.7.3'
            };
        });

        it('returns 200 and a command when given the command name and version', () => {
            commandFactoryMock.getCommand.resolves(testcommand);

            return server.inject(options).then((reply) => {
                assert.deepEqual(reply.result, testcommand);
                assert.calledWith(commandFactoryMock.getCommand, 'foo/bar@1.7.3');
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 and a command when given the command name and tag', () => {
            options = {
                method: 'GET',
                url: '/commands/foo/bar/stable'
            };
            commandFactoryMock.getCommand.resolves(testcommand);

            return server.inject(options).then((reply) => {
                assert.deepEqual(reply.result, testcommand);
                assert.calledWith(commandFactoryMock.getCommand, 'foo/bar@stable');
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 404 when command does not exist', () => {
            commandFactoryMock.getCommand.resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when datastore fails', () => {
            commandFactoryMock.getCommand.rejects(new Error('some error'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /commands/namespace/name', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/commands/screwdriver/build'
            };
        });

        it('returns 200 and all command versions for a command namespace/name', () => {
            commandFactoryMock.list.resolves(getCommandMocks(testcommandVersions));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testcommandVersions);
                assert.calledWith(commandFactoryMock.list, {
                    params: {
                        namespace: 'screwdriver',
                        name: 'build'
                    },
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and all command versions with pagination', () => {
            commandFactoryMock.list.resolves(getCommandMocks(testcommandVersions));
            options.url = '/commands/screwdriver/build?count=30';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testcommandVersions);
                assert.calledWith(commandFactoryMock.list, {
                    params: {
                        namespace: 'screwdriver',
                        name: 'build'
                    },
                    paginate: {
                        page: undefined,
                        count: 30
                    },
                    sort: 'descending'
                });
            });
        });

        it('returns 404 when command does not exist', () => {
            commandFactoryMock.list.resolves([]);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });
    });

    describe('DELETE /commands/namespace/name', () => {
        const pipelineId = 123;
        const scmUri = 'github.com:12345:branchName';
        const username = 'myself';
        const scmContext = 'github@github.com';
        let pipeline;
        let options;
        let userMock;
        let testCommand;
        let testCommandTag;

        beforeEach(() => {
            options = {
                method: 'DELETE',
                url: '/commands/foo/bar',
                credentials: {
                    username,
                    scmContext,
                    scope: ['user', '!guest']
                }
            };
            testCommand = decorateObj({
                id: 1,
                namespace: 'foo',
                name: 'bar',
                tag: 'stable',
                version: '1.0.0',
                pipelineId,
                remove: sinon.stub().resolves(null)
            });
            testCommandTag = decorateObj({
                id: 1,
                remove: sinon.stub().resolves(null)
            });

            userMock = getUserMock({ username, scmContext });
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

            pipeline = getPipelineMocks(testpipeline);
            pipelineFactoryMock.get.withArgs(pipelineId).resolves(pipeline);

            commandFactoryMock.list.resolves([testCommand]);
            commandTagFactoryMock.list.resolves([testCommandTag]);
        });

        afterEach(() => {
            nock.cleanAll();
        });

        it('returns 404 when command does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Command foo/bar does not exist'
            };

            commandFactoryMock.list.resolves([]);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 403 when user does not have admin permissions', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'User myself does not have admin access for this command'
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when user does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'User myself does not exist'
            };

            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when pipeline does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: `Pipeline ${pipelineId} does not exist`
            };

            pipelineFactoryMock.get.withArgs(pipelineId).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('deletes command if admin user credentials provided and command exists', () => {
            nock('http://store.example.com')
                .delete('/v1/commands/foo/bar/1.0.0')
                .reply(204, '');

            return server.inject(options).then((reply) => {
                assert.calledOnce(testCommand.remove);
                assert.calledOnce(testCommandTag.remove);
                assert.equal(reply.statusCode, 204);
            });
        });

        it('returns 204 even when command binary is not found', () => {
            nock('http://store.example.com')
                .delete('/v1/commands/foo/bar/1.0.0')
                .reply(404, '');

            return server.inject(options).then((reply) => {
                assert.notCalled(testCommand.remove);
                assert.calledOnce(testCommandTag.remove);
                assert.equal(reply.statusCode, 500);
            });
        });

        it('throws error when store returns an error', () => {
            nock('http://store.example.com')
                .delete('/v1/commands/foo/bar/1.0.0')
                .replyWithError({ message: 'request to the store is error' });

            return server.inject(options).then((reply) => {
                assert.notCalled(testCommand.remove);
                assert.calledOnce(testCommandTag.remove);
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 403 when build credential pipelineId does not match target pipelineId', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'Not allowed to remove this command'
            };

            options = {
                method: 'DELETE',
                url: '/commands/foo/bar',
                credentials: {
                    username,
                    scmContext,
                    pipelineId: 1337,
                    scope: ['build']
                }
            };

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 403 if it is a PR build', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'Not allowed to remove this command'
            };

            options = {
                method: 'DELETE',
                url: '/commands/foo/bar',
                credentials: {
                    isPR: true,
                    username,
                    scmContext,
                    pipelineId: 1337,
                    scope: ['build']
                }
            };
            options.credentials.isPR = true;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('deletes command if build credentials provided and pipelineIds match', () => {
            nock('http://store.example.com')
                .delete('/v1/commands/foo/bar/1.0.0')
                .reply(204, '');

            options = {
                method: 'DELETE',
                url: '/commands/foo/bar',
                credentials: {
                    username,
                    scmContext,
                    pipelineId,
                    scope: ['build']
                }
            };

            return server.inject(options).then((reply) => {
                assert.calledOnce(testCommand.remove);
                assert.calledOnce(testCommandTag.remove);
                assert.equal(reply.statusCode, 204);
            });
        });
    });

    describe('POST /commands', () => {
        let options;
        let commandMock;
        let pipelineMock;
        let testId = 7969;
        let expected;
        let formData;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: '/commands',
                payload: COMMAND_VALID,
                credentials: {
                    scope: ['build']
                }
            };

            expected = {
                format: 'habitat',
                habitat: {
                    mode: 'remote',
                    package: 'core/git/2.14.1',
                    command: 'git'
                },
                description: COMMAND_DESCRIPTION,
                maintainer: 'foo@bar.com',
                namespace: 'foo',
                name: 'bar',
                version: '1.1.2',
                pipelineId: 123
            };

            commandMock = getCommandMocks(testcommand);
            commandFactoryMock.create.resolves(commandMock);
            commandFactoryMock.list.resolves([commandMock]);

            pipelineMock = getPipelineMocks(testpipeline);
            pipelineFactoryMock.get.resolves(pipelineMock);

            formData = new FormData();
        });

        it('returns 403 when pipelineId does not match', () => {
            commandMock.pipelineId = 8888;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 403 if it is a PR build', () => {
            options.credentials.isPR = true;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('creates command if command does not exist yet', () => {
            commandFactoryMock.list.resolves([]);

            return server.inject(options).then((reply) => {
                const expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testId}`
                };

                assert.deepEqual(reply.result, testcommand);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(commandFactoryMock.list, {
                    params: {
                        namespace: 'foo',
                        name: 'bar'
                    }
                });
                assert.calledWith(commandFactoryMock.create, expected);
                assert.equal(reply.statusCode, 201);
            });
        });

        it('creates command if has good permission and it is a new version', () => {
            options.payload = COMMAND_VALID_NEW_VERSION;
            expected.version = '1.2';
            commandFactoryMock.list.resolves([commandMock]);
            nock('http://store.example.com')
                .post('/v1/commands/bar/foo/1.0.1')
                .reply(202, '');

            return server.inject(options).then((reply) => {
                const expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testId}`
                };

                assert.deepEqual(reply.result, testcommand);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(commandFactoryMock.list, {
                    params: {
                        namespace: 'foo',
                        name: 'bar'
                    }
                });
                assert.calledWith(commandFactoryMock.create, expected);
                assert.equal(reply.statusCode, 201);
            });
        });

        it('returns 500 when the command model fails to get', () => {
            const testError = new Error('commandModelGetError');

            commandFactoryMock.list.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the command model fails to create', () => {
            const testError = new Error('commandModelCreateError');

            commandFactoryMock.create.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 400 when the command is invalid', () => {
            options.payload = COMMAND_INVALID;
            commandFactoryMock.list.resolves([]);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 400);
            });
        });

        describe('Binary format', () => {
            beforeEach(() => {
                formData = new FormData();
                testId = 1234;
                expected = {
                    binary: { file: './foobar.sh' },
                    description: 'Command for binary commands',
                    format: 'binary',
                    maintainer: 'foo@bar.com',
                    name: 'foo',
                    namespace: 'bar',
                    pipelineId: 123,
                    version: '1.1.2'
                };
                commandMock = getCommandMocks(testBinaryCommand);
                commandFactoryMock.create.resolves(commandMock);
                commandFactoryMock.list.resolves([commandMock]);

                pipelineMock = getPipelineMocks(testpipeline);
                pipelineFactoryMock.get.resolves(pipelineMock);
            });

            afterEach(() => {
                nock.cleanAll();
            });

            it('returns 400 when only the binary is posted', () => {
                formData.append('file', COMMAND_BINARY, 'foobar.sh');
                options.headers = formData.getHeaders();
                options.headers.Authoriztion = 'AuthToken';

                return streamToPromise(formData).then((payload) => {
                    options.payload = payload;

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 400);
                    });
                });
            });

            it('returns 400 when only the meta is posted in binary case', () => {
                const spec = { format: 'binary' };

                formData.append('spec', JSON.stringify(spec));
                options.headers = formData.getHeaders();
                options.headers.Authoriztion = 'AuthToken';

                return streamToPromise(formData).then((payload) => {
                    options.payload = payload;

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 400);
                    });
                });
            });

            it('returns 400 when only the meta is posted in habitat local mode case', () => {
                const spec = { format: 'habitat', habitat: { mode: 'local' } };

                formData.append('spec', JSON.stringify(spec));
                options.headers = formData.getHeaders();
                options.headers.Authoriztion = 'AuthToken';

                return streamToPromise(formData).then((payload) => {
                    options.payload = payload;

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 400);
                    });
                });
            });

            it('returns 403 when pipelineId does not match', () => {
                formData.append('spec', BINARY_COMMAND_VALID, 'sd-command.yaml');
                formData.append('file', COMMAND_BINARY, 'foobar.sh');
                options.headers = formData.getHeaders();
                options.headers.Authorization = 'AuthToken';
                commandMock.pipelineId = 8888;

                return streamToPromise(formData).then((payload) => {
                    options.payload = payload;

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 403);
                    });
                });
            });

            it('creates command if command does not exist yet', () => {
                formData.append('spec', BINARY_COMMAND_VALID, 'sd-command.yaml');
                formData.append('file', COMMAND_BINARY, 'foobar.sh');
                options.headers = formData.getHeaders();
                options.headers.Authoriztion = 'AuthToken';
                commandFactoryMock.getCommand.resolves(null);
                commandFactoryMock.list.resolves([]);
                nock('http://store.example.com')
                    .post('/v1/commands/bar/foo/1.1.0')
                    .reply(202, '');

                return streamToPromise(formData).then((payload) => {
                    options.payload = payload;

                    return server.inject(options).then((reply) => {
                        const expectedLocation = {
                            host: reply.request.headers.host,
                            port: reply.request.headers.port,
                            protocol: reply.request.server.info.protocol,
                            pathname: `${options.url}/${testId}`
                        };

                        assert.deepEqual(reply.result, testBinaryCommand);
                        assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                        assert.calledWith(commandFactoryMock.list, {
                            params: {
                                namespace: 'bar',
                                name: 'foo'
                            }
                        });
                        assert.calledWith(commandFactoryMock.create, expected);
                        assert.equal(reply.statusCode, 201);
                    });
                });
            });

            it('creates command if has good permission and it is a new version', () => {
                expected.version = '1.2';
                formData.append('spec', BINARY_COMMAND_VALID_NEW_VERSION, 'sd-command.yaml');
                formData.append('file', COMMAND_BINARY, 'foobar.sh');
                options.headers = formData.getHeaders();
                options.headers.Authoriztion = 'AuthToken';
                commandFactoryMock.getCommand.resolves(testBinaryCommand);
                commandFactoryMock.list.resolves([commandMock]);
                nock('http://store.example.com')
                    .post('/v1/commands/bar/foo/1.0.1')
                    .reply(202, '');

                return streamToPromise(formData).then((payload) => {
                    options.payload = payload;

                    return server.inject(options).then((reply) => {
                        const expectedLocation = {
                            host: reply.request.headers.host,
                            port: reply.request.headers.port,
                            protocol: reply.request.server.info.protocol,
                            pathname: `${options.url}/${testId}`
                        };

                        assert.deepEqual(reply.result, testBinaryCommand);
                        assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                        assert.calledWith(commandFactoryMock.list, {
                            params: {
                                namespace: 'bar',
                                name: 'foo'
                            }
                        });
                        assert.calledWith(commandFactoryMock.create, expected);
                        assert.equal(reply.statusCode, 201);
                    });
                });
            });

            it('returns 500 when the command model fails to get', () => {
                const testError = new Error('commandModelGetError');

                formData.append('spec', BINARY_COMMAND_VALID, 'sd-command.yaml');
                formData.append('file', COMMAND_BINARY, 'foobar.sh');
                options.headers = formData.getHeaders();
                options.headers.Authoriztion = 'AuthToken';
                commandFactoryMock.getCommand.rejects(testError);
                commandFactoryMock.list.resolves([]);

                return streamToPromise(formData).then((payload) => {
                    options.payload = payload;

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 500);
                    });
                });
            });

            it('returns 500 when the command model fails to create', () => {
                const testError = new Error('commandModelCreateError');

                formData.append('spec', BINARY_COMMAND_VALID, 'sd-command.yaml');
                formData.append('file', COMMAND_BINARY, 'foobar.sh');
                options.headers = formData.getHeaders();
                options.headers.Authoriztion = 'AuthToken';
                commandFactoryMock.getCommand.resolves([]);
                commandFactoryMock.create.rejects(testError);

                return streamToPromise(formData).then((payload) => {
                    options.payload = payload;

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 500);
                    });
                });
            });

            it('returns 400 when the command is invalid', () => {
                formData.append('spec', BINARY_COMMAND_INVALID, 'sd-command.yaml');
                formData.append('file', COMMAND_BINARY, 'foobar.sh');
                options.headers = formData.getHeaders();
                options.headers.Authoriztion = 'AuthToken';
                commandFactoryMock.getCommand.resolves([]);
                commandFactoryMock.list.resolves([]);

                return streamToPromise(formData).then((payload) => {
                    options.payload = payload;

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 400);
                    });
                });
            });

            it('returns 500 when request to the store is failed', () => {
                formData.append('spec', BINARY_COMMAND_VALID, 'sd-command.yaml');
                formData.append('file', COMMAND_BINARY, 'foobar.sh');
                options.headers = formData.getHeaders();
                options.headers.Authoriztion = 'AuthToken';
                commandFactoryMock.getCommand.resolves(null);
                commandFactoryMock.list.resolves([]);
                nock.cleanAll();
                nock('http://store.example.com')
                    .post('/v1/commands/bar/foo/1.1.0')
                    .replyWithError({ message: 'request to the store is error' });

                return streamToPromise(formData).then((payload) => {
                    options.payload = payload;

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 500);
                    });
                });
            });

            it('returns 500 when the binary fails to store', () => {
                formData.append('spec', BINARY_COMMAND_VALID, 'sd-command.yaml');
                formData.append('file', COMMAND_BINARY, 'foobar.sh');
                options.headers = formData.getHeaders();
                options.headers.Authoriztion = 'AuthToken';
                commandFactoryMock.getCommand.resolves(null);
                commandFactoryMock.list.resolves([]);
                nock.cleanAll();
                nock('http://store.example.com')
                    .post('/v1/commands/bar/foo/1.1.0')
                    .reply(500, '');

                return streamToPromise(formData).then((payload) => {
                    options.payload = payload;

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 500);
                    });
                });
            });
        });
    });

    describe('GET /commands/namespace/name/tags', () => {
        it('returns 200 and all command tags for a command namespace and name', () => {
            const options = {
                method: 'GET',
                url: '/commands/foo/bar/tags'
            };

            commandTagFactoryMock.list.resolves(getCommandMocks(testcommandTags));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testcommandTags);
                assert.calledWith(commandTagFactoryMock.list, {
                    params: {
                        namespace: 'foo',
                        name: 'bar'
                    },
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and all commands tags with pagination', () => {
            commandTagFactoryMock.list.resolves(getCommandMocks(testcommandTags));
            const options = {
                method: 'GET',
                url: '/commands/foo/bar/tags?count=30'
            };

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testcommandTags);
                assert.calledWith(commandTagFactoryMock.list, {
                    params: {
                        namespace: 'foo',
                        name: 'bar'
                    },
                    paginate: {
                        page: undefined,
                        count: 30
                    },
                    sort: 'descending'
                });
            });
        });

        it('returns 500 when fails to get command tags', () => {
            const options = {
                method: 'GET',
                url: '/commands/some/error/tags'
            };
            const testError = new Error('getCommandTagError');

            commandTagFactoryMock.list.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 200 and an empty array when there are no command tags', () => {
            const options = {
                method: 'GET',
                url: '/commands/cmd/with-no-tags/tags'
            };

            commandTagFactoryMock.list.resolves([]);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, []);
                assert.calledWith(commandTagFactoryMock.list, {
                    params: {
                        namespace: 'cmd',
                        name: 'with-no-tags'
                    },
                    sort: 'descending'
                });
            });
        });
    });

    describe('PUT /commands/namespace/name/tags', () => {
        let options;
        let commandMock;
        let pipelineMock;
        const payload = {
            version: '1.2.0'
        };
        const payloadTag = {
            version: 'latest'
        };
        const testCommandTag = decorateObj(hoek.merge({ id: 1 }, payload));

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: '/commands/screwdriver/test/tags/stable',
                payload,
                credentials: {
                    scope: ['build']
                }
            };

            commandMock = getCommandMocks(testcommand);
            commandFactoryMock.get.resolves(commandMock);

            commandTagFactoryMock.get.resolves(null);

            pipelineMock = getPipelineMocks(testpipeline);
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns 403 when pipelineId does not match', () => {
            commandMock.pipelineId = 8888;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 403 if it is a PR build', () => {
            options.credentials.isPR = true;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 404 when command does not exist', () => {
            commandFactoryMock.get.resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('creates a command tag if it has permission and tag does not exist', () => {
            commandTagFactoryMock.create.resolves(testCommandTag);

            return server.inject(options).then((reply) => {
                const expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/1`
                };

                assert.deepEqual(reply.result, hoek.merge({ id: 1 }, payload));
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(commandFactoryMock.get, {
                    namespace: 'screwdriver',
                    name: 'test',
                    version: '1.2.0'
                });
                assert.calledWith(commandTagFactoryMock.get, {
                    namespace: 'screwdriver',
                    name: 'test',
                    tag: 'stable'
                });
                assert.calledWith(commandTagFactoryMock.create, {
                    namespace: 'screwdriver',
                    name: 'test',
                    tag: 'stable',
                    version: '1.2.0'
                });
                assert.equal(reply.statusCode, 201);
            });
        });

        it('updates a command tag if it has permission and tag exists', () => {
            const command = hoek.merge({
                update: sinon.stub().resolves(testCommandTag)
            }, testCommandTag);

            commandTagFactoryMock.get.resolves(command);

            return server.inject(options).then((reply) => {
                assert.calledWith(commandFactoryMock.get, {
                    namespace: 'screwdriver',
                    name: 'test',
                    version: '1.2.0'
                });
                assert.calledWith(commandTagFactoryMock.get, {
                    namespace: 'screwdriver',
                    name: 'test',
                    tag: 'stable'
                });
                assert.calledOnce(command.update);
                assert.notCalled(commandTagFactoryMock.create);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('creates a command tag with tag if it has permission and tag does not exists', () => {
            commandTagFactoryMock.create.resolves(testCommandTag);
            commandTagFactoryMock.get.onFirstCall().resolves(testCommandTag);
            commandTagFactoryMock.get.onSecondCall().resolves(null);

            options.payload = payloadTag;

            return server.inject(options).then((reply) => {
                const expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/1`
                };

                assert.deepEqual(reply.result, hoek.merge({ id: 1 }, payload));
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(commandFactoryMock.get, {
                    namespace: 'screwdriver',
                    name: 'test',
                    version: '1.2.0'
                });
                assert.calledWith(commandTagFactoryMock.get, {
                    namespace: 'screwdriver',
                    name: 'test',
                    tag: 'stable'
                });
                assert.calledWith(commandTagFactoryMock.create, {
                    namespace: 'screwdriver',
                    name: 'test',
                    tag: 'stable',
                    version: '1.2.0'
                });
                assert.calledTwice(commandTagFactoryMock.get);
                assert.equal(reply.statusCode, 201);
            });
        });

        it('updates a command tag with tag if it has permission and tag exists', () => {
            const command = hoek.merge({
                update: sinon.stub().resolves(testCommandTag)
            }, testCommandTag);

            commandTagFactoryMock.get.resolves(command);
            options.payload = payloadTag;

            return server.inject(options).then((reply) => {
                assert.calledWith(commandFactoryMock.get, {
                    namespace: 'screwdriver',
                    name: 'test',
                    version: '1.2.0'
                });
                assert.calledWith(commandTagFactoryMock.get, {
                    namespace: 'screwdriver',
                    name: 'test',
                    tag: 'stable'
                });
                assert.calledTwice(commandTagFactoryMock.get);
                assert.calledOnce(command.update);
                assert.notCalled(commandTagFactoryMock.create);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 500 when the command tag model fails to create', () => {
            const testError = new Error('commandModelCreateError');

            commandTagFactoryMock.create.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /commands/trusted', () => {
        let options;
        let testCommand;

        const payload = {
            trusted: true
        };

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: '/commands/foo/bar/trusted',
                payload,
                credentials: {
                    scope: ['admin']
                }
            };

            testCommand = decorateObj({
                id: 1,
                namespace: 'foo',
                name: 'bar',
                tag: 'stable',
                version: '1.0.0',
                update: sinon.stub().resolves(null)
            });

            commandFactoryMock.list.resolves([testCommand]);
        });

        it('returns 404 when command does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Command foo/bar does not exist'
            };

            commandFactoryMock.list.resolves([]);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 403 when user does not have admin permissions', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'Insufficient scope'
            };

            options.credentials.scope = ['user'];

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('update to mark command trusted', () => {
            server.inject(options).then((reply) => {
                assert.calledOnce(testCommand.update);
                assert.equal(reply.statusCode, 204);
            });
        });
    });
});
