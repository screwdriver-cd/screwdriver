'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const hoek = require('@hapi/hoek');
const testStage = require('./data/stage.json');
const testStageBuilds = require('./data/stageBuilds.json');

sinon.assert.expose(assert, { prefix: '' });

const decorateObj = obj => {
    const mock = hoek.clone(obj);

    mock.toJson = sinon.stub().returns(obj);

    return mock;
};

const getStageBuildMocks = stageBuilds => {
    if (Array.isArray(stageBuilds)) {
        return stageBuilds.map(decorateObj);
    }

    return decorateObj(stageBuilds);
};

const getStageMocks = stages => {
    if (Array.isArray(stages)) {
        return stages.map(decorateObj);
    }

    return decorateObj(stages);
};

describe('stage plugin test', () => {
    let stageFactoryMock;
    let stageBuildFactoryMock;
    let plugin;
    let server;

    beforeEach(async () => {
        stageFactoryMock = {
            get: sinon.stub(),
            list: sinon.stub()
        };
        stageBuildFactoryMock = {
            list: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/stages');
        /* eslint-enable global-require */
        server = new hapi.Server({
            port: 1234
        });
        server.app = {
            stageFactory: stageFactoryMock,
            stageBuildFactory: stageBuildFactoryMock
        };

        server.auth.scheme('custom', () => ({
            authenticate: (request, h) =>
                h.authenticated({
                    credentials: {
                        scope: ['user']
                    }
                })
        }));
        server.auth.strategy('token', 'custom');

        await server.register({ plugin });
    });

    afterEach(() => {
        server = null;
    });

    it('registers the plugin', () => {
        assert.isOk(server.registrations.stages);
    });

    describe('GET /stages/{id}', () => {
        const id = 123;
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/stages/${id}`,
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
        });

        it('returns 200 for get stage', () => {
            stageFactoryMock.get.resolves(getStageMocks(testStage));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testStage);
            });
        });

        it('throws error not found when stage does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Stage 123 does not exist'
            };

            stageFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('throws error when call returns error', () => {
            stageFactoryMock.get.withArgs(id).rejects(new Error('Failed'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /stages/id/stageBuilds', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/stages/1234/stageBuilds'
            };
        });

        it('returns 200 and stageBuilds when given the stage id', () => {
            stageFactoryMock.get.resolves(testStage);
            stageBuildFactoryMock.list.resolves(getStageBuildMocks(testStageBuilds));

            return server.inject(options).then(reply => {
                assert.deepEqual(reply.result, testStageBuilds);
                assert.calledWith(stageFactoryMock.get, 1234);
                assert.calledWith(stageBuildFactoryMock.list, { sort: 'descending', params: { stageId: 1234 } });
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 and stageBuilds when given the stage id with request query params', () => {
            const expectedStageBuildArgs = {
                sort: 'descending',
                params: {
                    stageId: 1234,
                    eventId: 220
                },
                paginate: {
                    page: 1,
                    count: 1
                }
            };

            options.url = '/stages/1234/stageBuilds?page=1&count=1&eventId=220';

            stageFactoryMock.get.resolves(testStage);
            stageBuildFactoryMock.list.resolves(getStageBuildMocks(testStageBuilds));

            return server.inject(options).then(reply => {
                assert.deepEqual(reply.result, testStageBuilds);
                assert.calledWith(stageFactoryMock.get, 1234);
                assert.calledWith(stageBuildFactoryMock.list, expectedStageBuildArgs);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 404 when stage does not exist', () => {
            stageFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when datastore fails for stageFactory', () => {
            stageFactoryMock.get.rejects(new Error('some error'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when datastore fails for stageBuildFactory', () => {
            stageFactoryMock.get.resolves(testStage);
            stageBuildFactoryMock.list.resolves(new Error('some error'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });
});
