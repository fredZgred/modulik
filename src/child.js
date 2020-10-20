const { parentController } = require('./bridge');

process.on('SIGTERM', () => {
  process.exit(0);
});

const modulePath = process.argv[2];
const childModule = require(modulePath);

const moduleType = typeof childModule;
let serializable = false;
try {
  const serialized = JSON.stringify(childModule);
  serializable = Boolean(serialized);
} catch (e) {
  serializable = false;
}

if (moduleType === 'function') {
  process.on(
    'message',
    parentController.makeMessageHandler({
      async onInvoke({ correlationId, args }) {
        let result = null;
        try {
          const data = await childModule(...args);
          result = { data };
        } catch (e) {
          result = { data: e.message, error: true };
        }
        process.send(
          parentController.invocationResult({ correlationId, result }),
        );
      },
    }),
  );
}

process.send(
  parentController.ready({
    type: moduleType,
    body: serializable ? childModule : undefined,
  }),
);
