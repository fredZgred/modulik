const { createMachine, assign, interpret, send, spawn } = require('xstate');

const isState = (state, name) => state.toStrings().includes(name);

const fsWatcherChart = {
  id: 'fsWatcher',
  initial: 'starting',
  states: {
    starting: {
      entry: 'startFSWatcher',
      FS_WATCHER_READY: 'ready',
    },
    ready: {
      on: {
        STOP: 'stopped',
      },
    },
    stopping: {
      entry: 'stopFsWatcher',
      on: {
        FS_WATCHER_STOPPED: 'stopped',
      },
    },
    stopped: {
      final: true,
      entry: 'stopFSWatcher',
    },
  },
};

const childProcessChart = {
  id: 'childProcess',
  context: {
    exitedWithError: false,
  },
  on: {
    STOP: {
      target: 'killing',
      actions: 'clearExitedWithErrorFlag',
    },
  },
  initial: 'starting',
  states: {
    starting: {
      entry: 'startChildProcess',
      on: {
        CHILD_PROCESS_READY: 'ready',
        CHILD_PROCESS_EXITED: {
          target: 'killed',
          actions: 'setExitedWithErrorFlag',
        },
      },
    },
    ready: {
      on: {
        CHILD_PROCESS_EXITED: {
          target: 'killed',
          actions: 'setExitedWithErrorFlag',
        },
      },
    },
    killing: {
      entry: 'killChildProcess',
      on: {
        CHILD_PROCESS_EXITED: {
          target: 'killed',
          actions: 'setExitedWithErrorFlag',
        },
      },
    },
    killed: {
      on: {
        CHILD_PROCESS_START: {
          target: 'starting',
          actions: 'clearExitedWithErrorFlag',
        },
      },
    },
    stopped: {
      final: true,
    },
  },
};

const mainChart = {
  id: 'main',
  initial: 'idle',
  context: {
    fsWatcher: null,
    childProcess: null,
    restartExpected: false,
  },
  states: {
    idle: {
      on: {
        START: 'setup',
        KILL_REQUESTED: {
          target: 'killed',
          actions: 'rejectModuleWithAvailabilityError',
        },
      },
    },
    setup: {
      entry: 'spawnFsWatcher',
      always: { target: 'starting', cond: 'isFsWatcherReady' },
      on: {
        KILL_REQUESTED: {
          target: 'killing',
          actions: 'rejectModuleWithAvailabilityError',
        },
      },
    },
    starting: {
      entry: 'spawnChildProcess',
      always: [
        { target: 'restarting', cond: 'isRestartExpected' },
        { target: 'failed', cond: 'didChildProcessExitedWithError' },
        { target: 'accessible' },
      ],
      on: {
        MODULE_CHANGED: { actions: 'setRestartExpectedFlag' },
        RESTART_REQUESTED: { actions: 'setRestartExpectedFlag' },
        KILL_REQUESTED: {
          target: 'killing',
          actions: 'rejectModuleWithAvailabilityError',
        },
      },
      exit: 'clearRestartExpectedFlag',
    },
    accessible: {
      entry: ['resolveModule', 'logReady', 'handlePendingExecutions'],
      initial: 'childProcessRunning',
      states: {
        childProcessRunning: {
          on: {
            MODULE_CHANGED: [{ target: '#main.restarting' }],
            RESTART_REQUESTED: [{ target: '#main.restarting' }],
            CHILD_PROCESS_EXITED: [
              { target: '#main.failed', cond: 'didProcessExitWithError' },
              { target: '#main.accessible.childProcessExited' },
            ],
            KILL_REQUESTED: [{ target: '#main.killing' }],
          },
        },
        childProcessExited: {
          on: {
            MODULE_CHANGED: [{ target: '#main.restarting.childProcessExited' }],
            RESTART_REQUESTED: [
              { target: '#main.restarting.childProcessExited' },
            ],
            KILL_REQUESTED: [{ target: '#main.killing.stoppingFSWatcher' }],
          },
        },
      },
    },
    restarting: {
      entry: ['logRestarting', 'recreateModulePromise', 'stopChildProcess'],
      initial: 'childProcessRunning',
      states: {
        childProcessRunning: {
          on: {
            CHILD_PROCESS_EXITED: [
              { target: '#main.failed', cond: 'didProcessExitWithError' },
              { target: '#main.restarting.childProcessExited' },
            ],
            KILL_REQUESTED: [
              {
                target: '#main.killing',
                actions: ['rejectModuleWithAvailabilityError'],
              },
            ],
          },
        },
        childProcessExited: {
          on: {
            '': [{ target: '#main.starting' }],
          },
        },
      },
    },
    failed: {
      entry: ['logFailed', 'rejectModuleWithFailureError'],
      on: {
        MODULE_CHANGED: [{ target: '#main.restarting.childProcessExited' }],
        RESTART_REQUESTED: [{ target: '#main.restarting.childProcessExited' }],
        KILL_REQUESTED: [{ target: '#main.killing.stoppingFSWatcher' }],
      },
    },
    killing: {
      entry: ['killFsWatcher', 'killChildProcess'],
      always: { target: '#main.killed', cond: 'didAllServicesStop' },
      on: {
        RESTART_REQUESTED: { actions: 'logCannotRestartKilledModule' },
      },
    },
    killed: {
      entry: 'notifyKilled',
      final: true,
      on: {
        RESTART_REQUESTED: { actions: 'logCannotRestartKilledModule' },
      },
    },
  },
};

const createState = ({
  recreateModulePromise,
  resolveModule,
  rejectModuleWithFailureError,
  rejectModuleWithAvailabilityError,
  handlePendingExecutions,
  startFSWatcher,
  stopFSWatcher,
  startChildProcess,
  stopChildProcess,
  notifyKilled,
  logReady,
  logRestarting,
  logFailed,
  logCannotRestartKilledModule,
}) => {
  const fsWatcherMachine = createMachine(fsWatcherChart, {
    actions: {
      startFSWatcher,
      stopFSWatcher,
    },
  });

  const childProcessMachine = createMachine(childProcessChart, {
    actions: {
      startChildProcess,
      killChildProcess: stopChildProcess,
      setExitedWithErrorFlag: assign({
        exitedWithError: (_, event) => !!event.error,
      }),
      clearExitedWithErrorFlag: assign({
        exitedWithError: false,
      }),
    },
  });

  const mainMachine = createMachine(mainChart, {
    actions: {
      spawnFsWatcher: assign({
        fsWatcher: () =>
          spawn(fsWatcherMachine, { name: 'fsWatcher', sync: true }),
      }),
      killFsWatcher: ctx => ctx.fsWatcher.stop(),

      spawnChildProcess: assign({
        childProcess: () =>
          spawn(childProcessMachine, { name: 'childProcess', sync: true }),
      }),
      stopChildProcess: ctx => send('STOP', { to: ctx.childProcess }),
      killChildProcess: ctx => ctx.childProcess.stop(),

      recreateModulePromise,
      resolveModule: (_, { data }) => {
        resolveModule({ data });
      },
      rejectModuleWithFailureError,
      rejectModuleWithAvailabilityError,
      handlePendingExecutions: (_, { data }) => {
        handlePendingExecutions({ data });
      },
      notifyKilled,
      logReady,
      logRestarting,
      logFailed,
      logCannotRestartKilledModule,
      setRestartExpectedFlag: assign({
        restartExpected: true,
      }),
      clearRestartExpectedFlag: assign({
        restartExpected: false,
      }),
    },
    guards: {
      isFsWatcherReady: ctx => isState(ctx.fsWatcher.state, 'ready'),
      isRestartExpected: ctx => ctx.restartExpected,
      didChildProcessExitedWithError: ctx =>
        isState(ctx.childProcess.state, 'killed') &&
        ctx.childProcess.state.context.exitedWithError,
      didAllServicesStop: ctx =>
        isState(ctx.fsWatcher, 'stopped') &&
        isState(ctx.childProcess, 'stopped'),
    },
  });
  const service = interpret(mainMachine);
  service.start();

  process.nextTick(() => {
    service.send('START');
  });

  return {
    isStarting: () => isState(service.state, 'starting'),
    isAccessible: () => isState(service.state, 'accessible'),
    isKilled: () => isState(service.state, 'killed'),
    fSWatcherReady: () =>
      service.state.context.fsWacher.send('FS_WATCHER_READY'),
    moduleChanged: () => service.state.context.fsWacher.send('MODULE_CHANGED'),
    restartRequested: () => service.send('RESTART_REQUESTED'),
    ready: data => service.send('READY', data),
    execute: args => service.send('EXECUTE', { args }),
    processExited: ({ error }) =>
      service.state.context.childProcess.send('CHILD_PROCESS_EXITED', {
        error,
      }),
    killRequested: () => service.send('KILL_REQUESTED'),
    fSWatcherStopped: () => service.send('FS_WATCHER_STOPPED'),
  };
};

module.exports = createState;
