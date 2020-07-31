# Coverage Plugin
> Hapi coverage plugin for the Screwdriver API

## Usage

```javascript
const Hapi = require('@hapi/hapi');
const server = new Hapi.Server();
const coveragePlugin = require('./');

server.connection({ port: 3000 });

server.register({
    register: coveragePlugin,
    options: {}
}, () => {
    server.start((err) => {
        if (err) {
            throw err;
        }
        console.log('Server running at:', server.info.uri);
    });
});

```

### Routes

#### Returns an access token to talk to coverage server
`GET /coverage/token`

#### Get an object with coverage info

`GET /coverage/info?buildId=1&jobId=123&startTime=2017-10-19T13%3A00%3A00%2B0200&endTime=2017-10-19T15%3A00%3A00%2B0200`

Should resolve with something like
```javascript
{
    coverage: '98.8',
    projectUrl: 'https://sonar.screwdriver.cd/dashboard?id=job%3A123'
}
```
