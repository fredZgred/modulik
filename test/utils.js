const { writeFileSync, existsSync, readFileSync } = require('fs');
const chokidar = require('chokidar');
const rimraf = require('rimraf');

const wait = ms =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

const spyOn = (obj, prop) => {
  const originalPropValue = obj[prop];
  const calls = [];
  // eslint-disable-next-line no-param-reassign
  obj[prop] = (...args) => {
    calls.push(args);
    return originalPropValue(...args);
  };
  return {
    free: () => {
      // eslint-disable-next-line no-param-reassign
      obj[prop] = originalPropValue;
    },
    get calls() {
      return [...calls];
    },
  };
};

const schedulerQueue = [];
const scheduler = {
  add(action) {
    schedulerQueue.push(action);
  },
  async run() {
    await schedulerQueue.reduce(
      (acc, action) => acc.then(() => action()),
      Promise.resolve(),
    );
    schedulerQueue.length = 0;
  },
};

const attachListener = (paths, events, onChange) =>
  new Promise(resolve => {
    const fsWatcher = chokidar.watch(paths, { ignoreInitial: true });
    events.forEach(event => {
      fsWatcher.on(event, () => {
        setImmediate(async () => {
          await fsWatcher.close();
          onChange();
        });
      });
    });
    fsWatcher.on('ready', resolve);
  });

const writeFileAndWait = (path, content) =>
  new Promise(async resolve => {
    if (existsSync(path) && readFileSync(path, 'utf-8') === content) {
      resolve();
      return;
    }
    await attachListener(path, ['add', 'change'], resolve);
    writeFileSync(path, content);
  });

const deleteFileAndWait = path =>
  new Promise(async resolve => {
    if (!existsSync(path)) {
      resolve();
      return;
    }
    await attachListener(path, ['unlink'], resolve);
    rimraf.sync(path);
  });

module.exports = {
  wait,
  spyOn,
  scheduler,
  writeFileAndWait,
  deleteFileAndWait,
};
