'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const testBanner = require('./data/banner.json');
const testBanners = require('./data/banners.json');
const testBannersActive = require('./data/banners-active.json');
const updatedBanner = require('./data/updatedBanner.json');

sinon.assert.expose(assert, { prefix: '' });

const getMock = obj => {
    const mock = { ...obj };

    mock.update = sinon.stub();
    mock.toJson = sinon.stub().returns(obj);
    mock.remove = sinon.stub();

    return mock;
};

const getBannerMock = banner => {
    if (Array.isArray(banner)) {
        return banner.map(getMock);
    }

    return getMock(banner);
};

describe('banner plugin test', () => {
    let bannerMock;
    let bannerFactoryMock;
    let plugin;
    let server;
    let scm;

    beforeEach(async () => {
        scm = {
            getScmContexts: sinon.stub().returns(['github:github.com']),
            getDisplayName: sinon.stub().returns('github'),
            getBellConfiguration: sinon.stub().resolves({
                'github:github.com': {
                    clientId: 'abcdefg',
                    clientSecret: 'hijklmno',
                    provider: 'github',
                    scope: ['admin:repo_hook', 'read:org', 'repo:status']
                }
            })
        };
        bannerFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub(),
            list: sinon.stub(),
            scm
        };

        bannerMock = getMock(testBanner);
        bannerMock.remove.resolves(null);
        bannerMock.update.resolves(bannerMock);
        bannerFactoryMock.create.resolves(bannerMock);

        /* eslint-disable global-require */
        plugin = require('../../plugins/banners');
        /* eslint-enable global-require */

        server = new hapi.Server({
            port: 1234
        });
        server.app = {
            bannerFactory: bannerFactoryMock
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

        await server.register({
            plugin,
            options: {
                admins: ['github:jimgrund', 'github:batman']
            }
        });
    });

    afterEach(() => {
        server = null;
    });

    it('registers the plugin', () => {
        assert.isOk(server.registrations.banners);
    });

    describe('POST /banners', () => {
        let options;
        const username = 'jimgrund';
        const scmContext = 'github:github.com';
        const message = 'Test banner example';
        const isActive = true;
        const type = 'info';
        const scope = 'GLOBAL';

        beforeEach(() => {
            options = {
                method: 'POST',
                url: '/banners',
                payload: {
                    message,
                    isActive,
                    type,
                    scope
                },
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            bannerFactoryMock.get.resolves(null);
        });

        it('returns 201 and creates a banner', () =>
            server.inject(options).then(reply => {
                const expected = { ...options.payload };

                expected.createdBy = options.auth.credentials.username;
                assert.calledWith(bannerFactoryMock.create, expected);
                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, testBanner);
            }));

        it('returns 201 and creates a banner using default type', () => {
            delete options.payload.type;

            return server.inject(options).then(reply => {
                const expected = { ...options.payload };

                expected.createdBy = options.auth.credentials.username;
                assert.calledWith(bannerFactoryMock.create, expected);
                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, testBanner);
            });
        });

        it('returns 201 and creates a banner using default isActive', () => {
            delete options.payload.isActive;

            return server.inject(options).then(reply => {
                const expected = { ...options.payload };

                expected.createdBy = options.auth.credentials.username;
                assert.calledWith(bannerFactoryMock.create, expected);
                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, testBanner);
            });
        });

        it('returns 403 for non-admin user', () => {
            options.auth.credentials.username = 'batman123';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 500 when banner fails to create', () => {
            const testError = new Error('bannerModelError');

            bannerFactoryMock.create.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /banners', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/banners'
            };
        });

        it('returns 200 for listing banners', () => {
            bannerFactoryMock.list.resolves(getBannerMock(testBanners));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testBanners);
            });
        });

        it('returns 200 for listing banners with query params', () => {
            options.url = '/banners?isActive=true';
            bannerFactoryMock.list.resolves(getBannerMock(testBannersActive));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testBannersActive);
            });
        });
    });

    describe('GET /banners/{id}', () => {
        let options;
        const id = 123;
        const username = 'jimgrund';
        const scmContext = 'github:github.com';

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/banners/${id}`,
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
        });

        it('returns 200 for get banner', () => {
            bannerFactoryMock.get.withArgs(id).resolves(bannerMock);

            return server.inject(options).then(reply => {
                const expected = { ...testBanner };

                delete expected.id;
                delete expected.createdBy;
                delete expected.createTime;
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testBanner);
            });
        });

        it('returns 404 when banner does not exist', () => {
            bannerFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });
    });

    describe('PUT /banners/{id}', () => {
        let options;
        let updatedBannerMock;
        const id = 123;
        const username = 'jimgrund';
        const scmContext = 'github:github.com';

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: `/banners/${id}`,
                payload: {
                    message: 'This is a new banner',
                    isActive: true,
                    type: 'warn'
                },
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            updatedBannerMock = getMock(updatedBanner);
            bannerFactoryMock.get.withArgs(id).resolves(bannerMock);
            bannerMock.update.resolves(updatedBannerMock);
            updatedBannerMock.toJson.returns(updatedBanner);
        });

        it('returns 200 updating banner by admin user', () =>
            server.inject(options).then(reply => {
                assert.deepEqual(reply.result, updatedBanner);
                assert.calledOnce(bannerMock.update);
                assert.equal(reply.statusCode, 200);
            }));

        it('returns 404 when banner id does not exist', () => {
            bannerFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 403 updating banner by non-admin user', () => {
            options.auth.credentials.username = 'batman123';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });
    });

    describe('DELETE /banners/{id}', () => {
        let options;
        const id = 123;
        const username = 'jimgrund';
        const scmContext = 'github:github.com';

        beforeEach(() => {
            options = {
                method: 'DELETE',
                url: `/banners/${id}`,
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            bannerFactoryMock.get.withArgs(id).resolves(bannerMock);
        });

        it('returns 204 when delete is success', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
                assert.calledOnce(bannerMock.remove);
            }));

        it('returns 403 deleting banner by non-admin user', () => {
            options.auth.credentials.username = 'batman123';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 404 when banner id does not exist', () => {
            bannerFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });
    });
});
