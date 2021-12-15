# Events Plugin
> Hapi events plugin for the Screwdriver API

## Usage

```javascript
const Hapi = require('@hapi/hapi');
const server = new Hapi.Server();
const eventsPlugin = require('./');

server.connection({ port: 3000 });

server.register({
    register: eventsPlugin,
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

#### Returns a single event
`GET /events/{id}`

#### Returns a list of builds associated with the event
`GET /events/{id}/builds`

`GET /events/{id}/builds?steps=true`


#### Get build metrics for a single event
`GET /events/{id}/metrics`

`GET /events/{id}/metrics?startTime=2019-02-01T12:00:00.000Z`

`GET /events/{id}/metrics?startTime=2019-02-01T12:00:00.000Z&endTime=2019-03-01T12:00:00.000`

#### Stops all builds associated with the event
`PUT /events/{id}/stop`


### Access to Factory methods
The server supplies factories to plugins in the form of server app values:

```js
// handler eventsPlugin.js
handler: async (request, h) => {
    const factory = request.server.app.eventFactory;

    // ...
}
```
