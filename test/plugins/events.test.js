'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const hoek = require('hoek');
const testBuilds = require('./data/builds.json');
const testEvent = require('./data/events.json')[0];

sinon.assert.expose(assert, { prefix: '' });
require('sinon-as-promised');

const decorateBuildMock = (build) => {
    const mock = hoek.clone(build);

    mock.toJson = sinon.stub().returns(build);

    return mock;
};

const getBuildMocks = (builds) => {
    if (Array.isArray(builds)) {
        return builds.map(decorateBuildMock);
    }

    return decorateBuildMock(builds);
};

const decorateEventMock = (event) => {
    const decorated = hoek.clone(event);

    decorated.getBuilds = sinon.stub();
    decorated.toJson = sinon.stub().returns(event);

    return decorated;
};

describe('event plugin test', () => {
    let factoryMock;
    let plugin;
    let server;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        factoryMock = {
            get: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/events');
        /* eslint-enable global-require */

        server = new hapi.Server();
        server.app = {
            eventFactory: factoryMock
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
        assert.isOk(server.registrations.events);
    });

    describe('GET /events/{id}', () => {
        const id = 12345;

        it('exposes a route for getting a event', () => {
            factoryMock.get.withArgs(id).resolves(decorateEventMock(testEvent));

            return server.inject('/events/12345')
                .then((reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.deepEqual(reply.result, testEvent);
                });
        });

        it('returns 404 when event does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Event does not exist'
            };

            factoryMock.get.withArgs(id).resolves(null);

            return server.inject('/events/12345')
                .then((reply) => {
                    assert.equal(reply.statusCode, 404);
                    assert.deepEqual(reply.result, error);
                });
        });

        it('returns errors when datastore returns an error', () => {
            factoryMock.get.withArgs(id).rejects(new Error('blah'));

            return server.inject('/events/12345')
                .then((reply) => {
                    assert.equal(reply.statusCode, 500);
                });
        });
    });

    describe('GET /events/{id}/builds', () => {
        const id = '12345';
        let options;
        let event;
        let builds;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/events/${id}/builds`
            };

            event = decorateEventMock(testEvent);
            builds = getBuildMocks(testBuilds);

            factoryMock.get.withArgs(id).resolves(event);
            event.getBuilds.resolves(builds);
        });

        it('returns 404 if event does not exist', () => {
            factoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 200 for getting builds', () =>
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testBuilds);
            })
        );
    });
});
