const { fork } = require('child_process');
const path = require('path');
const chokidar = require('chokidar');
const { createChildController } = require('./bridge');
const createLogger = require('./logger');
const createState = require('./state');

const moduleStateIdle = 'moduleStateIdle';
const moduleStateStarting = 'moduleStateStarting';
const moduleStateAccessible = 'moduleStateAccessible';
const childPath = path.resolve(__dirname, 'child.js');

const launchFully = ({
  cfg,
  recreateModulePromise,
  resolveModule,
  rejectModule,
}) => {
  const moduleFileName = path.parse(cfg.path).base;
  const logger = createLogger(moduleFileName, cfg.quiet);
  const childController = createChildController();

  let child = null;
  let fsWatcher = null;
  let currentModuleBody = null;
  let moduleState = moduleStateIdle;
  let moduleKilled = false;
  let changesDuringStart = false;

  const moduleBodyOfFunctionType = (...args) =>
    new Promise((resolve, reject) => {
      if (moduleKilled) {
        reject(new Error('Cannot execute killed module'));
        return;
      }
      // when former module was of function type
      // and after file change it is not a function anymore
      // but still there is a attempt to execute the former module
      if (
        moduleState === moduleStateAccessible &&
        typeof currentModuleBody !== 'function'
      ) {
        reject(
          new Error(
            `Cannot execute module of ${typeof currentModuleBody} type`,
          ),
        );
        return;
      }

      childController.bufferInvocation(args, (error, data) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(data);
      });
      if (moduleState === moduleStateAccessible) {
        childController.releaseBufferedInvocations(message => {
          child.send(message);
        });
      }
    });

  const runChild = () => {
    if (moduleState === moduleStateStarting) return;
    moduleState = moduleStateStarting;

    child = fork(childPath, [cfg.path]);
    child.on(
      'message',
      childController.makeMessageHandler({
        onInvocationResult({ correlationId, result }) {
          childController.resolveInvocation({ correlationId, result });
        },
        onModuleReady({ data }) {
          if (changesDuringStart) {
            changesDuringStart = false;
            // eslint-disable-next-line no-use-before-define
            restartChild();
            return;
          }

          const { type, body } = data;
          currentModuleBody =
            type === 'function' ? moduleBodyOfFunctionType : body;

          moduleState = moduleStateAccessible;
          resolveModule(currentModuleBody);
          logger.info('Ready.');

          if (type === 'function') {
            childController.releaseBufferedInvocations(message => {
              child.send(message);
            });
            return;
          }

          if (childController.areThereInvocationsBuffered()) {
            childController.resolveAllInvocations({
              error: true,
              data: 'Module is not a function. Cannot execute.',
            });
            logger.error(
              'There were executions buffered, but the module is not a function anymore. Buffered executions has been forgotten.',
            );
          }
        },
      }),
    );
    child.on('exit', code => {
      const previousModuleState = moduleState;
      moduleState = moduleStateIdle;

      if (code === 0) return;
      // module has been programmatically killed
      if (code === null && previousModuleState === moduleStateIdle) {
        // module was not fully evaluated yet
        if (!currentModuleBody) {
          rejectModule(new Error('Module unavailable'));
        }
        return;
      }

      // module exited because of unknown reason
      logger.error('Exited unexpectedly');
      rejectModule(new Error('Module exited unexpectedly'));
    });
  };

  const stopChild = () =>
    new Promise(resolve => {
      if (moduleState === moduleStateIdle) {
        resolve();
        return;
      }
      child.on('exit', () => {
        resolve();
      });
      moduleState = moduleStateIdle;
      child.kill();
    });

  const restartChild = async () => {
    if (moduleKilled) {
      logger.error('Module killed - cannot restart');
      return;
    }
    logger.info('Restarting..');
    recreateModulePromise();
    await stopChild();
    runChild();
  };

  const handleFileChange = () => {
    if (moduleState === moduleStateStarting) {
      changesDuringStart = true;
      return;
    }
    restartChild();
  };

  fsWatcher = chokidar
    .watch(cfg.watch, { ignoreInitial: true })
    .on('all', handleFileChange);
  runChild();

  const kill = async () => {
    if (moduleKilled) return;
    moduleKilled = true;
    await fsWatcher.close();
    await stopChild();
  };

  return {
    restart: restartChild,
    kill,
  };
};

const l = ({ cfg, recreateModulePromise, resolveModule, rejectModule }) => {
  const moduleFileName = path.parse(cfg.path).base;
  const logger = createLogger(moduleFileName, cfg.quiet);
  const childController = createChildController();

  let fsWatcher = null;
  let childProcess = null;
  let currentModuleBody = null;
  let resolveKillRequestPromise = null;
  const killRequestPromise = new Promise(resolve => {
    resolveKillRequestPromise = resolve;
  });

  const state = createState({
    logReady: () => logger.info('Ready.'),
    logRestarting: () => logger.info('Restarting..'),
    logFailed: () => logger.error('Exited unexpectedly'),
    logCannotRestartKilledModule: () =>
      logger.error('Module killed - cannot restart'),
    recreateModulePromise,
    resolveModule: ({ data: { type, body } }) => {
      currentModuleBody = type === 'function' ? moduleBodyOfFunctionType : body;
      resolveModule(currentModuleBody);
    },
    rejectModuleWithFailureError: () => {
      rejectModule(new Error('Module exited unexpectedly'));
    },
    rejectModuleWithAvailabilityError: () => {
      rejectModule(new Error('Module unavailable'));
    },
    rejectModuleWithExecutionOfKilledModuleError: () => {
      rejectModule(new Error('Cannot execute killed module'));
    },
    startFSWatcher: () => {
      fsWatcher = chokidar
        .watch(cfg.watch, { ignoreInitial: true })
        .on('all', () => {
          state.moduleChanged();
        })
        .on('ready', () => {
          state.fSWatcherReady();
        });
    },
    startChildProcess: () => {
      childProcess = fork(childPath, [cfg.path]);
      childProcess.on(
        'message',
        childController.makeMessageHandler({
          onInvocationResult({ correlationId, result }) {
            childController.resolveInvocation({ correlationId, result });
          },
          onModuleReady: ({ data }) => {
            state.ready({ data });
          },
        }),
      );
      childProcess.on('exit', code => {
        state.processExited({ error: code !== 0 });
      });
    },
    handlePendingExecutions: ({ data: { type } }) => {
      if (type === 'function') {
        childController.releaseBufferedInvocations(message => {
          childProcess.send(message);
        });
        return;
      }

      if (childController.areThereInvocationsBuffered()) {
        childController.resolveAllInvocations({
          error: true,
          data: 'Module is not a function. Cannot execute.',
        });
        logger.error(
          'There were executions buffered, but the module is not a function anymore. Buffered executions has been forgotten.',
        );
      }
    },
    stopChildProcess: () => {
      childProcess.kill();
    },
    stopFSWatcher: async () => {
      await fsWatcher.close();
      state.fSWatcherStopped();
    },
    notifyKilled: () => {
      resolveKillRequestPromise();
    },
  });

  const moduleBodyOfFunctionType = (...args) =>
    new Promise((resolve, reject) => {
      if (state.isKilled()) {
        reject(new Error('Cannot execute killed module'));
        return;
      }
      // when former module was of function type
      // and after file change it is not a function anymore
      // but still there is a attempt to execute the former module
      if (state.isAccessible() && typeof currentModuleBody !== 'function') {
        reject(
          new Error(
            `Cannot execute module of ${typeof currentModuleBody} type`,
          ),
        );
        return;
      }

      childController.bufferInvocation(args, (error, data) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(data);
      });
      if (state.isAccessible()) {
        childController.releaseBufferedInvocations(message => {
          childProcess.send(message);
        });
      }
    });

  return {
    restart: () => state.restartRequested(),
    kill: () => {
      state.killRequested();
      return killRequestPromise;
    },
  };
};

const launchPhantomly = ({ cfg, resolveModule, rejectModule }) => {
  const moduleFileName = path.parse(cfg.path).base;
  const logger = createLogger(moduleFileName, cfg.quiet);
  process.nextTick(() => {
    try {
      const moduleBody = require(cfg.path);
      resolveModule(moduleBody);
      logger.info('Ready.');
    } catch (e) {
      process.stderr.write(`${e.stack}\n`);
      logger.error('Exited unexpectedly');
      rejectModule(new Error('Module exited unexpectedly'));
    }
  });

  return {
    restart: () => {},
    kill: () => {},
  };
};

const launch = ({ cfg, recreateModulePromise, resolveModule, rejectModule }) =>
  (cfg.disabled ? launchPhantomly : l)({
    cfg,
    recreateModulePromise,
    resolveModule,
    rejectModule,
  });

module.exports = launch;
