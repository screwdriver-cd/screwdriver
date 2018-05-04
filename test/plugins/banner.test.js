'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
// const hoek = require('hoek');
const testBanner = require('./data/banner.json');
const testBanners = require('./data/banners.json');

sinon.assert.expose(assert, { prefix: '' });

const getMock = (obj) => {
    const mock = Object.assign({}, obj);

    mock.update = sinon.stub();
    mock.toJson = sinon.stub().returns(obj);
    mock.remove = sinon.stub();

    return mock;
};

const getBannerMock = (banner) => {
    if (Array.isArray(banner)) {
        return banner.map(getMock);
    }

    return getMock(banner);
};

describe.only('banner plugin test', () => {
    let bannerMock;
    let bannerFactoryMock;
    let plugin;
    let server;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        bannerFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub(),
            list: sinon.stub()
        };

        bannerMock = getMock(testBanner);
        bannerMock.remove.resolves(null);
        bannerMock.update.resolves(bannerMock);
        bannerMock.update.resolves(bannerMock);

        /* eslint-disable global-require */
        plugin = require('../../plugins/banner');
        /* eslint-enable global-require */

        server = new hapi.Server();
        server.app = {
            bannerFactory: bannerFactoryMock
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
        assert.isOk(server.registrations.banners);
    });

    describe('POST /banner', () => {
        let options;
        const username = 'jimgrund';
        const scmContext = 'github:github.com';
        const message = 'This is a test banner';
        const isActive = true;
        const type = 'info';

        beforeEach(() => {
            options = {
                method: 'POST',
                url: '/banner',
                payload: {
                    message,
                    isActive,
                    type
                },
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
                }
            };
            bannerFactoryMock.get.resolves(null);
        });

        it('returns 201 and creates a banner', () => {
            server.inject(options).then((reply) => {
                const expected = Object.assign({}, testBanner);

                delete expected.id;
                delete expected.createdBy;
                delete expected.createTime;
                assert.calledWith(bannerFactoryMock.create, expected);
                assert.equal(reply.statusCode, 201);
                assert.equal(reply.result, testBanner);
            });
        });
    });

    describe('GET /banner', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/banner'
            };
        });

        it('returns 200 for listing banners', () => {
            bannerFactoryMock.list.resolves(getBannerMock(testBanners));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testBanners);
            });
        });
    });

    describe('GET /banner/{id}', () => {
        let options;
        const bannerId = 123;
        const username = 'jimgrund';
        const scmContext = 'github:github.com';

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/banner/${bannerId}`,
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
                }
            };
        });

        // it('returns 200 for get banner', () => {
        //     bannerFactoryMock.get.resolves(getBannerMock(testBanners));

        //     return server.inject(options).then((reply) => {
        //         assert.equal(reply.statusCode, 200);
        //         assert.deepEqual(reply.result, testBanners);
        //     });
        // });

        it('returns 404 when banner does not exist', () => {
            bannerFactoryMock.get.resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });
    });
});
