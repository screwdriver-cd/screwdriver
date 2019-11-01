'use strict';

const Joi = require("joi");
const tasks = {};
const taskSchema = Joi.object({
    taskname: Joi.string().required(),
    task: Joi.func().required(),
    timeout: Joi.number().integer()
});

/**
 * Hapi interface for plugin to handle serve graceful shutdown
 * @method register
 * @param  {Hapi.Server}    server
 * @param  {Object}         options
 */
exports.register = (server, options, next) => {
    const taskHandler = async (resolve, reject) => {
        try {
            await Promise.all(Object.keys(tasks).map(async key => {
                server.log(["shutdown"], `executing task ${key}`, new Date().toISOString())
                let item = tasks[key]
                await item.task();
            }))
            resolve()
        }
        catch (err) {
            console.log(err)
            reject(err)
        }
    }
    const gracefulStop = async () => {
        try {
            server.log(["shutdown"], `gracefully shutting down server`, new Date().toISOString());
            await server.root.stop({
                timeout: 5000
            });
            process.exit(0);
        }
        catch (err) {
            console.log(err)
            process.exit(1);
        }
    }

    const onSigterm = async () => {
        try {
            server.log(["shutdown"], "got SIGTERM; running triggers before shutdown", new Date().toISOString());
            let res = await promiseTimeout(taskHandler, options.terminationGracePeriod * 1000)
            if(res) {
                server.log(["shutdown"], res, new Date().toISOString());
            }
            await gracefulStop()
        }
        catch (err) {
            console.log(err)
        }
    }

    process.on('SIGTERM', onSigterm)
    server.expose('handler', register);
    next()
}

exports.register.attributes = {
    name: 'shutdown'
};

function register(task) {
    let res = taskSchema.validate(task);
    if (res.error) {
        return res.error;
    }
    tasks[task.taskname] = task;
}

function promiseTimeout(fn, timeout) {
    return new Promise(function (resolve, reject) {
        fn(resolve, reject);

        // Set up the timeout
        setTimeout(function () {
            resolve('Promise timed out after ' + timeout + ' ms');
        }, timeout);
    });
}