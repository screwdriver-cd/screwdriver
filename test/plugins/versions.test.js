'use strict';

const { assert } = require('chai');
const fs = require('fs');
const hapi = require('@hapi/hapi');
const licenseChecker = require('license-checker');
const sinon = require('sinon');

sinon.assert.expose(assert, { prefix: '' });

describe('versions plugin test', () => {
    /**
     * Generate a new Hapi server with a specified init function
     * @method registerServer
     * @return {HapiServer}                  Hapi Server to use
     */
    async function registerServer() {
        sinon.stub(fs, 'existsSync').returns(false);

        /* eslint-disable global-require */
        const plugin = require('../../plugins/versions');
        /* eslint-enable global-require */

        const server = new hapi.Server({
            port: 1234
        });

        await server.register({ plugin });

        return server;
    }

    afterEach(() => {
        sinon.restore();
    });

    describe('GET /versions', () => {
        it('returns 200 for a successful yaml', async () => {
            sinon.stub(licenseChecker, 'init').yieldsAsync(null, {
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
            });

            const server = await registerServer();
            const reply = await server.inject({ url: '/versions' });

            assert.equal(reply.statusCode, 200);
            assert.equal(JSON.stringify(reply.result.versions), JSON.stringify(['screwdriver-foo@0.1.2']));
            assert.equal(
                JSON.stringify(reply.result.licenses),
                JSON.stringify([
                    { name: 'screwdriver-foo', repository: 'bar', licenses: 'baz' },
                    { name: 'fake1', repository: 'bark1', licenses: 'UNKNOWN' },
                    { name: 'fake2', repository: 'UNKNOWN', licenses: 'bark2' },
                    { name: 'fake3', repository: 'bark3', licenses: 'bark4' }
                ])
            );
        });

        it('returns 500 for being unable to parse the package.json', () => {
            sinon.stub(licenseChecker, 'init').yieldsAsync(new Error('foobar'));

            registerServer().catch(error => {
                assert.match(error.toString(), /Unable to load package dependencies: foobar/);
            });
        });
    });
});
