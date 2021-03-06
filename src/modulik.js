const EventEmitter = require('events');
const path = require('path');
const getCallerFile = require('get-caller-file');
const launch = require('./launch');

const isItFirstSuchItem = (item, index, self) => self.indexOf(item) === index;
const systemSupportedExtensions = Object.keys(require.extensions).map(e =>
  e.replace('.', ''),
);

module.exports = (pathOrOptions, options) => {
  const providedConfig = Object.assign(
    {},
    typeof pathOrOptions === 'object' ? pathOrOptions : { path: pathOrOptions },
    typeof options === 'object' ? options : {},
  );
  if (!providedConfig.path) {
    throw new Error('Invalid module path');
  }

  const callerPath = path.dirname(getCallerFile());
  const cfg = {
    path: path.resolve(callerPath, providedConfig.path),
    quiet: Boolean(providedConfig.quiet),
    disabled: Boolean(providedConfig.disabled),
  };
  cfg.extensions = systemSupportedExtensions
    .concat(
      Array.isArray(providedConfig.extensions) ? providedConfig.extensions : [],
    )
    .filter(isItFirstSuchItem);
  cfg.watch = (Array.isArray(providedConfig.watch) ? providedConfig.watch : [])
    .concat(providedConfig.path)
    .filter(isItFirstSuchItem)
    .reduce((acc, filePath) => {
      const absolutePath = path.resolve(callerPath, filePath);
      return acc.concat([
        absolutePath,
        `${absolutePath}.{${cfg.extensions.join(',')}}`,
      ]);
    }, []);

  let moduleBodyPromise = null;
  let resolveModuleBodyPromise = () => {};
  let rejectModuleBodyPromise = () => {};
  const emitter = new EventEmitter();

  const recreateModuleBodyPromise = () => {
    moduleBodyPromise = new Promise((resolve, reject) => {
      resolveModuleBodyPromise = resolve;
      rejectModuleBodyPromise = reject;
    });
    // Prevent node from complaining about unhandled rejection
    moduleBodyPromise.catch(() => {});
  };

  const onRestart = () => {
    recreateModuleBodyPromise();
    emitter.emit('restart');
  };
  const onReady = moduleBody => {
    resolveModuleBodyPromise(moduleBody);
    emitter.emit('ready');
  };
  const onFailed = error => {
    rejectModuleBodyPromise(error);
    emitter.emit('failed', error);
  };

  recreateModuleBodyPromise();
  const { restart, kill } = launch({
    cfg,
    onRestart,
    onReady,
    onFailed,
  });

  return Object.setPrototypeOf(
    {
      get module() {
        return moduleBodyPromise;
      },
      restart: async () => restart(),
      kill: async () => kill(),
    },
    emitter,
  );
};
