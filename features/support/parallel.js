'use strict';

const { setParallelCanAssign } = require('@cucumber/cucumber');
const disabledRunScenarioInParallelTags = [
    '@apitoken',
    '@artifacts',
    '@environments',
    '@events',
    '@gitflow',
    '@sd-setup-scm',
    '@restrict-pr',
    '@secrets',
    '@trigger',
    '@user-teardown-step',
    '@workflow'
];

const disableRunScenarioInParallel = () => {
    setParallelCanAssign((pickleInQuestion, picklesInProgress) => {
        const blockQuestionTags = pickleInQuestion.tags
            .map(t => t.name)
            .filter(tag => disabledRunScenarioInParallelTags.includes(tag));

        if (blockQuestionTags.length > 0) {
            const progressTags = picklesInProgress.flatMap(p => p.tags.map(t => t.name));

            if (blockQuestionTags.some(tag => progressTags.includes(tag))) {
                return false;
            }
        }

        return true;
    });
};

module.exports = {
    disableRunScenarioInParallel
};
