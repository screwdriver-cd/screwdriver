#!/usr/bin/env node
/**
 * Make a user in the database and generate an access token for it
 * @param {String} username     Username for the new user
 * @param {String} gitToken     Git access token for the user
 */

'use strict';

/* eslint-disable import/no-dynamic-require */
/* eslint-disable no-console */

// Make sure script is being called correctly
if (process.argv.length !== 4) {
    console.log('Usage: npm run create-test-user -- $username $git-token');

    return 1;
}

const username = process.argv[2];
const gitToken = process.argv[3];

const config = require('config');
const hoek = require('hoek');

// Setup Authentication
const authConfig = config.get('auth');

// Setup HTTPd
const httpdConfig = config.get('httpd');

// Special urls for things like the UI
const ecosystem = config.get('ecosystem');

ecosystem.api = httpdConfig.uri;

// Setup Datastore
const datastoreConfig = config.get('datastore');
const DatastorePlugin = require(`screwdriver-datastore-${datastoreConfig.plugin}`);
const datastore = new DatastorePlugin(hoek.applyToDefaults({ ecosystem },
    (datastoreConfig[datastoreConfig.plugin] || {})));

// Source Code Plugin
const scmConfig = config.get('scm');
const ScmPlugin = require(`screwdriver-scm-${scmConfig.plugin}`);
const scm = new ScmPlugin(hoek.applyToDefaults({ ecosystem },
    (scmConfig[scmConfig.plugin] || {})));

authConfig.scm = scm;

// Setup Model Factories
const Models = require('screwdriver-models');
const userFactory = Models.UserFactory.getInstance({
    datastore,
    scm,
    password: authConfig.encryptionPassword
});
const tokenFactory = Models.TokenFactory.getInstance({
    datastore
});

// Setup datastore and create test user
return datastore.setup()
    .then(() => userFactory.get({ username }))
    .then((model) => {
        if (!model) {
            return userFactory.create({
                username,
                token: gitToken
            });
        }

        return model.sealToken(gitToken)
            .then((token) => {
                model.token = token;

                return model.update();
            });
    })
    .then(testUser => tokenFactory.create({
        name: 'Functional test token',
        userId: testUser.id
    }))
    .then(token => console.log(`Token created for user ${username}: ${token.value}`));
