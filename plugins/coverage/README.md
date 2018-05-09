# Coverage Plugin
> Hapi coverage plugin for the Screwdriver API

## Usage

```javascript
const Hapi = require('hapi');
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

#### Get an object with coverage links

`GET /coverage/links?buildId=1&jobId=123`

Should resolve with something like
```javascript
{
    badge: 'https://sonar.sd.cd/api/badges/measure?key=job%3A123&metric=coverage',
    project: 'https://sonar.sd.cd/dashboard?id=job%3A123'
}
```
