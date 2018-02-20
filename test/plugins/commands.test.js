'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const urlLib = require('url');
const hoek = require('hoek');
const testcommand = require('./data/command.json');
const testcommands = require('./data/commands.json');
const testcommandVersions = require('./data/commandVersions.json');
const testpipeline = require('./data/pipeline.json');
const COMMAND_INVALID = require('./data/command-validator.missing-version.json');
const COMMAND_VALID = require('./data/command-validator.input.json');
const COMMAND_VALID_NEW_VERSION = require('./data/command-create.input.json');
const COMMAND_DESCRIPTION = [
    'Command for habitat git',
    'Executes git commands\n'
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

describe('command plugin test', () => {
    let commandFactoryMock;
    let commandTagFactoryMock;
    let pipelineFactoryMock;
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
            get: sinon.stub(),
            remove: sinon.stub()
        };
        pipelineFactoryMock = {
            get: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/commands');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.app = {
            commandFactory: commandFactoryMock,
            commandTagFactory: commandTagFactoryMock,
            pipelineFactory: pipelineFactoryMock
        };
        server.connection({
            port: 1234
        });

        server.auth.scheme('custom', () => ({
            authenticate: (request, reply) => reply.continue({})
        }));
        server.auth.strategy('token', 'custom');
        server.auth.strategy('session', 'custom');

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
                    paginate: {
                        page: 1,
                        count: 50
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
                    paginate: {
                        page: 1,
                        count: 50
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

    describe('POST /commands', () => {
        let options;
        let commandMock;
        let pipelineMock;
        const testId = 7969;
        let expected;

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
        });

        it('returns 401 when pipelineId does not match', () => {
            commandMock.pipelineId = 8888;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 401);
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
    });
});
