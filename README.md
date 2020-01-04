# modulik

**modulik** allows to restart single module independently from the rest of your application.

Suppose you have a heavy server. You would like it to be restarted every change
in order to see the result immediately, but it takes very long time to fully
start it. Using modulik you are able to restart just particular part of
your server keeping the rest up and running continuously.

**Example:** there is a node server that supports
Server Side Rendering and uses webpack-dev-middleware. It starts
via nodemon, so any change to the code restarts whole server.

**Problems:**
1. every restart of server causes webpack-dev-middleware
to recompile from scratch whole client-app (which could be time consuming)
instead of just to apply a change.
1. even if you change only client-app related file you still need to
restart the server in order to consume new changes for SSR which leads
to problem 1.

**Solution:** use modulik to 1) import SSR module, 2) specify App
component to be watched for changes and 3) exclude SSR and App files from
nodemon watching.

**Result:**
1. changes to SSR module don't restart whole server but only SSR module itself.
1. changes to App component cause webpack-dev-middleware to just update
client-app's assets because whole server was not restarted but rather only the
SSR module.

The above case you can find in the [example](example) project.

## Installation

```bash
yarn add modulik
```

## Simple usage example

There are two modules:

`greet.js`
```js
module.exports = name => `Hello ${name}!`;
```

`app.js`
```js
const modulik = require('modulik');
const greetModulik = modulik('./greet');

setInterval(async () => {
  const greet = await greetModulik.module;
  const greeting = await greet('John');
  console.info(greeting);
  // -> Hello John!
}, 1000);
```

Every time `greet.js` file changes the app keeps running and only greet module
gets restarted. During the restart time module is not available, however
its invocations (`greet('John')`) are queued and once the module is back
they gets immediately executed.

For more sophisticated usage example check out the [example](example) project.

## API

### modulik

**modulik(modulePath[, options])**<br />
**modulik(options)**

 - `modulePath` *\<string>* Path to entry of the module. Specified file will be
 watched for changes
 - `options` *\<Object>*
    - `path` *\<string>* Path to entry of the module. Equal to `modulePath`
    argument. If both provided then `path` option overrides the `modulePath`
    - `watch` *\<Array>* Additional list of files or directories to be watched
    for changes
    - `extensions` *\<Array>* List of non-standard extensions that will be
    considered during watching for changes to files specified in `watch` option.
    All standard node extensions are considered anyway, so you don't need to
    specify e.g. *js* extension
    - `disabled` *\<boolean>* Disables functionality of watching for changes and
    restarting, and just exposes the module. **Default:** `false`
    - `quiet` *\<boolean>* Disables logs. **Default:** `false`
 - Returns: <[ModuleWrapper](#ModuleWrapper)>

```js
modulik('./path/to/module', {
  watch: ['./path/to/directory', '/absolute/path', './path/to/specific-module.js'],
  extensions: ['jsx'],
  disabled: PRODUCTION === true,
  quiet: true,
});
```
 
### ModuleWrapper

**ModuleWrapper.module**

 - Returns: \<Promise\<module>>
 
If your module is of function type then you can invoke function exposed by
ModuleWrapper.module property in order to execute your module and access its
result.
 
>  You can access a function result **only via Promsie API** even if your module
is not promise based
 
```js
const example = await exampleModulik.module;
const result = await example('some', 'arguments');
```

**ModuleWrapper.restart()**

 - Returns: \<Promise>
 
```js
await exampleModulik.restart();
console.info('My module is ready to be accessed');
```

**ModuleWrapper.kill()**

 - Returns: \<Promise>
 
```js
await exampleModulik.kill();
try {
  const example = await exampleModulik.module;
  await example('some', 'arguments');
} catch(e) {
  console.info('I can access my module, but can not execute it, because it is already killed');
}
```

## Limitations

to be written...
