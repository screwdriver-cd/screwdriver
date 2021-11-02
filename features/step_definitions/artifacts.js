"use strict"

const Assert = require("chai").assert
const { Before, Then, When} = require("cucumber")
const request = require("screwdriver-request")

const TIMEOUT = 240 * 1000

Before("@artifacts", function hook() {
    this.repoName = "functional-artifacts"

    // Reset shared information
    this.buildId = null
    this.pipelineId = null
    this.eventId = null
    this.jwt = null
})

When(/^the "ziped" job is started$/, { timeout: TIMEOUT }, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/events`,
        method: 'POST',
        json: {
            pipelineId: this.pipelineId,
            startFrom: 'ziped'
        },
        context: {
            token: this.jwt
        }
    })
        .then(resp => {
            Assert.equal(resp.statusCode, 201);
            this.eventId = resp.body.id;
        })
        .then(() =>
            request({
                url: `${this.instance}/${this.namespace}/events/${this.eventId}/builds`,
                method: 'GET',
                context: {
                    token: this.jwt
                }
            })
        )
        .then(resp => {
            Assert.equal(resp.statusCode, 200);
            this.buildId = resp.body[0].id;
        });
});

Then(/^the "ziped" build succeeds$/, { timeout: TIMEOUT }, function step() {
    return this.waitForBuild(this.buildId).then(resp => {
        Assert.equal(resp.body.status, 'SUCCESS');
        Assert.equal(resp.statusCode, 200);
    });
});

Then(
    /^artifacts were found in the build with the same event ID as the successful main job$/,
    { timeout: TIMEOUT },
    function step() {
        const artifactName1 = "sample1.txt"
        const artifactName2 = "sample2.txt"

        const retryConfig = {
            limit: 6,
            statusCodes: [
                408, 404, 413, 429, 500, 502, 503, 504, 521, 522, 524
            ],
            calculateDelay: ({ computedValue }) => {
                return computedValue
            },
            backoffLimit: 30000
        }

        const artifactRequest1 = request({
            url: `${this.instance}/${this.namespace}/builds/${this.buildId}/artifacts/${artifactName1}?type=preview`,
            method: "GET",
            context: {
                token: this.jwt
            },
            retry: retryConfig
        }).then((response) => {
            Assert.equal(response.statusCode, 200)
            Assert.equal(
                JSON.stringify(response.body),
                '{"name":"sample text 1"}'
            )
        })

        const artifactRequest2 = request({
            url: `${this.instance}/${this.namespace}/builds/${this.buildId}/artifacts/${artifactName2}?type=preview`,
            method: "GET",
            context: {
                token: this.jwt
            },
            retry: retryConfig
        }).then((response) => {
            Assert.equal(response.statusCode, 200)
            Assert.equal(
                JSON.stringify(response.body),
                '{"name":"sample text 2"}'
            )
        })

        return Promise.all([artifactRequest1, artifactRequest2])
    }
)
