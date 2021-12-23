'use strict';

const chai = require('chai');
const sinon = require('sinon');
const rewire = require('rewire');
const { assert } = chai;

chai.use(require('chai-as-promised'));

const RewiredWebhooksHelper = rewire('../../plugins/webhooks/helper.js');
/* eslint-disable no-underscore-dangle */
const ANNOT_CHAIN_PR = RewiredWebhooksHelper.__get__('ANNOT_CHAIN_PR');

sinon.assert.expose(assert, { prefix: '' });

describe('determineStartFrom function', () => {
    // eslint-disable-next-line no-underscore-dangle
    const determineStartFrom = RewiredWebhooksHelper.__get__('determineStartFrom');
    let action;
    let type;
    let targetBranch;
    let pipelineBranch;
    let releaseName;
    let tagName;
    let isReleaseOrTagFiltering;

    beforeEach(() => {
        action = 'push';
        type = 'repo';
        targetBranch = 'master';
        pipelineBranch = 'master';
        releaseName = '';
        tagName = 'v1';
        isReleaseOrTagFiltering = false;
    });

    it('determines to "~commit" when action is "push"', () => {
        assert.equal(
            determineStartFrom(
                action,
                type,
                targetBranch,
                pipelineBranch,
                releaseName,
                tagName,
                isReleaseOrTagFiltering
            ),
            '~commit'
        );
    });

    it('determines to "~commit:branch" when action is "push" and targetBranch is branch', () => {
        targetBranch = 'branch';

        assert.equal(
            determineStartFrom(
                action,
                type,
                targetBranch,
                pipelineBranch,
                releaseName,
                tagName,
                isReleaseOrTagFiltering
            ),
            '~commit:branch'
        );
    });

    it('determines to "~pr" when type is "pr"', () => {
        type = 'pr';

        assert.equal(
            determineStartFrom(
                action,
                type,
                targetBranch,
                pipelineBranch,
                releaseName,
                tagName,
                isReleaseOrTagFiltering
            ),
            '~pr'
        );
    });

    it('determines to "~pr:branch" when type is "pr" and targetBranch is branch', () => {
        type = 'pr';
        targetBranch = 'branch';

        assert.equal(
            determineStartFrom(
                action,
                type,
                targetBranch,
                pipelineBranch,
                releaseName,
                tagName,
                isReleaseOrTagFiltering
            ),
            '~pr:branch'
        );
    });

    it('determines to "~release" when action is "release"', () => {
        action = 'release';
        isReleaseOrTagFiltering = false;

        assert.equal(
            determineStartFrom(
                action,
                type,
                targetBranch,
                pipelineBranch,
                releaseName,
                tagName,
                isReleaseOrTagFiltering
            ),
            '~release'
        );
    });

    it('determines to "~release" when action is "release" even targetBranch is branch', () => {
        action = 'release';
        targetBranch = 'branch';
        isReleaseOrTagFiltering = false;

        assert.equal(
            determineStartFrom(
                action,
                type,
                targetBranch,
                pipelineBranch,
                releaseName,
                tagName,
                isReleaseOrTagFiltering
            ),
            '~release'
        );
    });

    it('determines to "~release:releaseName" when filter the release trigger', () => {
        action = 'release';
        releaseName = 'releaseName';
        isReleaseOrTagFiltering = true;

        assert.equal(
            determineStartFrom(
                action,
                type,
                targetBranch,
                pipelineBranch,
                releaseName,
                tagName,
                isReleaseOrTagFiltering
            ),
            '~release:releaseName'
        );
    });

    it('determines to "~tag" when action is "tag"', () => {
        action = 'tag';
        isReleaseOrTagFiltering = false;

        assert.equal(
            determineStartFrom(
                action,
                type,
                targetBranch,
                pipelineBranch,
                releaseName,
                tagName,
                isReleaseOrTagFiltering
            ),
            '~tag'
        );
    });

    it('determines to "~tag" when action is "tag" even targetBranch is branch', () => {
        action = 'tag';
        targetBranch = 'branch';
        isReleaseOrTagFiltering = false;

        assert.equal(
            determineStartFrom(
                action,
                type,
                targetBranch,
                pipelineBranch,
                releaseName,
                tagName,
                isReleaseOrTagFiltering
            ),
            '~tag'
        );
    });

    it('determines to "~tag:tagName" when filter the tag trigger', () => {
        action = 'tag';
        tagName = 'tagName';
        isReleaseOrTagFiltering = true;

        assert.equal(
            determineStartFrom(
                action,
                type,
                targetBranch,
                pipelineBranch,
                releaseName,
                tagName,
                isReleaseOrTagFiltering
            ),
            '~tag:tagName'
        );
    });
});

describe('resolveChainPR function', () => {
    it('resolves ChainPR flag', () => {
        // eslint-disable-next-line no-underscore-dangle
        const resolveChainPR = RewiredWebhooksHelper.__get__('resolveChainPR');

        let chainPR; // undefined;
        const pipeline = {
            annotations: {}
        };

        pipeline.annotations[ANNOT_CHAIN_PR] = undefined;
        assert.isFalse(resolveChainPR(chainPR, pipeline));
        pipeline.annotations[ANNOT_CHAIN_PR] = true;
        assert.isTrue(resolveChainPR(chainPR, pipeline));
        pipeline.annotations[ANNOT_CHAIN_PR] = false;
        assert.isFalse(resolveChainPR(chainPR, pipeline));

        chainPR = true;
        pipeline.annotations[ANNOT_CHAIN_PR] = undefined;
        assert.isTrue(resolveChainPR(chainPR, pipeline));
        pipeline.annotations[ANNOT_CHAIN_PR] = true;
        assert.isTrue(resolveChainPR(chainPR, pipeline));
        pipeline.annotations[ANNOT_CHAIN_PR] = false;
        assert.isFalse(resolveChainPR(chainPR, pipeline));

        chainPR = false;
        pipeline.annotations[ANNOT_CHAIN_PR] = undefined;
        assert.isFalse(resolveChainPR(chainPR, pipeline));
        pipeline.annotations[ANNOT_CHAIN_PR] = true;
        assert.isTrue(resolveChainPR(chainPR, pipeline));
        pipeline.annotations[ANNOT_CHAIN_PR] = false;
        assert.isFalse(resolveChainPR(chainPR, pipeline));
    });
});
