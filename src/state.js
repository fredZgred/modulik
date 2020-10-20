const { Machine, assign, interpret } = require('xstate');

const stateMachine = {
  id: 'root',
  initial: 'idle',
  context: {
    restartExpected: false,
    fSWatcherExited: false,
    childProcessExited: false,
  },
  states: {
    idle: {
      on: {
        START: [{ target: 'setup' }],
        KILL_REQUESTED: [
          {
            target: '#root.killed',
            actions: ['rejectModuleWithAvailabilityError'],
          },
        ],
      },
    },
    setup: {
      entry: ['startFSWatcher'],
      on: {
        FS_WATCHER_READY: [{ target: '#root.starting' }],
        KILL_REQUESTED: [
          {
            target: '#root.killing.stoppingFSWatcher',
            actions: ['rejectModuleWithAvailabilityError'],
          },
        ],
      },
    },
    starting: {
      entry: ['startChildProcess'],
      on: {
        MODULE_CHANGED: [{ actions: ['setRestartExpected'] }],
        RESTART_REQUESTED: [{ actions: ['setRestartExpected'] }],
        READY: [
          {
            target: '#root.restarting',
            cond: 'isRestartExpected',
          },
          { target: '#root.accessible' },
        ],
        PROCESS_EXITED: [{ target: '#root.failed' }],
        KILL_REQUESTED: [
          {
            target: '#root.killing',
            actions: ['rejectModuleWithAvailabilityError'],
          },
        ],
      },
      exit: ['clearRestartExpected'],
    },
    accessible: {
      entry: ['resolveModule', 'logReady', 'handlePendingExecutions'],
      initial: 'childProcessRunning',
      states: {
        childProcessRunning: {
          on: {
            MODULE_CHANGED: [{ target: '#root.restarting' }],
            RESTART_REQUESTED: [{ target: '#root.restarting' }],
            PROCESS_EXITED: [
              { target: '#root.failed', cond: 'didProcessExitWithError' },
              { target: '#root.accessible.childProcessExited' },
            ],
            KILL_REQUESTED: [{ target: '#root.killing' }],
          },
        },
        childProcessExited: {
          on: {
            MODULE_CHANGED: [{ target: '#root.restarting.childProcessExited' }],
            RESTART_REQUESTED: [
              { target: '#root.restarting.childProcessExited' },
            ],
            KILL_REQUESTED: [{ target: '#root.killing.stoppingFSWatcher' }],
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
            PROCESS_EXITED: [
              { target: '#root.failed', cond: 'didProcessExitWithError' },
              { target: '#root.restarting.childProcessExited' },
            ],
            KILL_REQUESTED: [
              {
                target: '#root.killing',
                actions: ['rejectModuleWithAvailabilityError'],
              },
            ],
          },
        },
        childProcessExited: {
          on: {
            '': [{ target: '#root.starting' }],
          },
        },
      },
    },
    failed: {
      entry: ['logFailed', 'rejectModuleWithFailureError'],
      on: {
        MODULE_CHANGED: [{ target: '#root.restarting.childProcessExited' }],
        RESTART_REQUESTED: [{ target: '#root.restarting.childProcessExited' }],
        KILL_REQUESTED: [{ target: '#root.killing.stoppingFSWatcher' }],
      },
    },
    killing: {
      initial: 'stoppingChildProcess',
      states: {
        stoppingChildProcess: {
          entry: ['stopChildProcess'],
          on: {
            PROCESS_EXITED: [{ target: '#root.killing.stoppingFSWatcher' }],
          },
        },
        stoppingFSWatcher: {
          entry: ['stopFSWatcher'],
          on: {
            FS_WATCHER_STOPPED: [{ target: '#root.killed' }],
          },
        },
      },
      on: {
        RESTART_REQUESTED: [{ actions: ['logCannotRestartKilledModule'] }],
      },
    },
    killed: {
      entry: ['notifyKilled'],
      final: true,
      on: {
        RESTART_REQUESTED: [{ actions: ['logCannotRestartKilledModule'] }],
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
  const machine = Machine(stateMachine, {
    actions: {
      recreateModulePromise,
      resolveModule: (_, { data }) => {
        resolveModule({ data });
      },
      rejectModuleWithFailureError,
      rejectModuleWithAvailabilityError,
      handlePendingExecutions: (_, { data }) => {
        handlePendingExecutions({ data });
      },
      startFSWatcher,
      stopFSWatcher,
      startChildProcess,
      stopChildProcess,
      notifyKilled,
      logReady,
      logRestarting,
      logFailed,
      logCannotRestartKilledModule,
      setRestartExpected: assign({
        restartExpected: true,
      }),
      clearRestartExpected: assign({
        restartExpected: false,
      }),
      setFSWatcherExited: assign({
        fSWatcherExited: true,
      }),
      setChildProcessExited: assign({
        childProcessExited: true,
      }),
    },
    guards: {
      isRestartExpected: ctx => ctx.restartExpected,
      didProcessExitWithError: (_, event) => event.error,
      didAllServicesExited: ctx =>
        ctx.fSWatcherExited && ctx.childProcessExited,
    },
  });
  const service = interpret(machine);
  service.start();

  process.nextTick(() => {
    service.send('START');
  });

  const isState = name => service.state.toStrings().includes(name);
  return {
    isStarting: () => isState('starting'),
    isAccessible: () => isState('accessible'),
    isKilled: () => isState('killed'),
    fSWatcherReady: () => service.send('FS_WATCHER_READY'),
    moduleChanged: () => service.send('MODULE_CHANGED'),
    restartRequested: () => service.send('RESTART_REQUESTED'),
    ready: data => service.send('READY', data),
    execute: args => service.send('EXECUTE', { args }),
    processExited: ({ error }) => service.send('PROCESS_EXITED', { error }),
    killRequested: () => service.send('KILL_REQUESTED'),
    fSWatcherStopped: () => service.send('FS_WATCHER_STOPPED'),
  };
};

module.exports = createState;
