'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');

sinon.assert.expose(assert, { prefix: '' });

describe('versions plugin test', () => {
    /**
     * Generate a new Hapi server with a specified init function
     * @method registerServer
     * @param  {Function}       initFunction Function to set license-checker to use
     * @return {HapiServer}                  Hapi Server to use
     */
    function registerServer(initFunction) {
        const mockChecker = {
            init: initFunction
        };

        mockery.registerMock('license-checker', mockChecker);

        /* eslint-disable global-require */
        const plugin = require('../../plugins/versions');
        /* eslint-enable global-require */

        const server = new hapi.Server();

        server.connection({
            port: 1234
        });

        return server.register([{
            register: plugin
        }]).then(() => server);
    }

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    afterEach(() => {
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    describe('GET /versions', () => {
        it('returns 200 for a successful yaml', () =>
            registerServer(sinon.stub().yieldsAsync(null, {
                'screwdriver-foo@0.1.2': {
                    repository: 'bar',
                    licenses: 'baz'
                },
                'fake1@1.2.3': {
                    repository: 'bark1'
                },
                'fake2@2.3.4': {
                    licenses: 'bark2'
                },
                'fake3@3.4.5': {
                    repository: 'bark3',
                    licenses: 'bark4'
                }
            }))
                .then(server => server.inject({
                    url: '/versions'
                }).then((reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.equal(JSON.stringify(reply.result.versions), JSON.stringify([
                        'screwdriver-foo@0.1.2'
                    ]));
                    assert.equal(JSON.stringify(reply.result.licenses), JSON.stringify([
                        { name: 'screwdriver-foo', repository: 'bar', licenses: 'baz' },
                        { name: 'fake1', repository: 'bark1', licenses: 'UNKNOWN' },
                        { name: 'fake2', repository: 'UNKNOWN', licenses: 'bark2' },
                        { name: 'fake3', repository: 'bark3', licenses: 'bark4' }
                    ]));
                }))
        );

        it('returns 500 for being unable to parse the package.json', () =>
            registerServer(sinon.stub().yieldsAsync(new Error('foobar')))
                .catch(error => assert.match(
                    error.toString(),
                    /Unable to load package dependencies: foobar/)
                )
        );
    });
});
