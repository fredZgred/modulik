const assert = require('assert');
const path = require('path');
const { existsSync, readFileSync } = require('fs');
const modulik = require('..');
const {
  spyOn,
  scheduler,
  writeFileAndWait,
  deleteFileAndWait,
} = require('./utils');

describe('Essential behaviour', () => {
  afterEach(async () => {
    await scheduler.run();
  });

  it('executes with minimal params with no problems', async () => {
    const moduleWatched1 = modulik('./resources/number-module');
    const moduleWatched2 = modulik({
      path: './resources/number-module.js',
    });
    scheduler.add(async () => {
      await moduleWatched1.kill();
      await moduleWatched2.kill();
    });

    assert.deepStrictEqual(Boolean(moduleWatched1), true);
    assert.deepStrictEqual(Boolean(moduleWatched2), true);
  });

  [
    {
      typeName: 'number',
      precondition: 'exports number',
      fileName: 'number-module.js',
      matcher: {
        type: 'number',
        value: 1,
      },
    },
    {
      typeName: 'string',
      precondition: 'exports string',
      fileName: 'string-module.js',
      matcher: {
        type: 'string',
        value: 'module',
      },
    },
    {
      typeName: 'object',
      precondition: 'exports object',
      fileName: 'object-module.js',
      matcher: {
        type: 'object',
        value: {},
      },
    },
    {
      typeName: 'function',
      precondition: 'exports function',
      fileName: 'function-module.js',
      matcher: {
        type: 'function',
        prepare: a => a instanceof Function,
      },
    },
    {
      typeName: 'object',
      precondition: 'does not export anything',
      fileName: 'empty-module.js',
      matcher: {
        type: 'object',
        prepare: a => a instanceof Object,
      },
    },
  ].forEach(({ typeName, precondition, fileName, matcher }) => {
    it(`exposes ${typeName} under "module" property when module ${precondition}`, async () => {
      const moduleWatched = modulik(`./resources/${fileName}`);
      scheduler.add(async () => {
        await moduleWatched.kill();
      });
      const exposedModule = await moduleWatched.module;

      assert.deepStrictEqual(typeof exposedModule, matcher.type);
      if (matcher.value) {
        assert.deepStrictEqual(exposedModule, matcher.value);
      }
      if (matcher.prepare) {
        assert.deepStrictEqual(matcher.prepare(exposedModule), true);
      }
    });

    it(`exposes ${typeName} under "module" property when module ${precondition} and disable option is set to true`, async () => {
      const moduleWatched = modulik(`./resources/${fileName}`, {
        disable: true,
      });
      scheduler.add(async () => {
        await moduleWatched.kill();
      });
      const exposedModule = await moduleWatched.module;

      assert.deepStrictEqual(typeof exposedModule, matcher.type);
      if (matcher.value) {
        assert.deepStrictEqual(exposedModule, matcher.value);
      }
      if (matcher.prepare) {
        assert.deepStrictEqual(matcher.prepare(exposedModule), true);
      }
    });
  });

  it('throws when accessing module if there is no module under provided path', async () => {
    const invalidModulik1 = modulik('/invalid/module/path');
    const invalidModulik2 = modulik('/invalid/module/path', { disabled: true });
    scheduler.add(async () => {
      await invalidModulik1.kill();
      await invalidModulik2.kill();
    });
    await (async () => {
      try {
        await invalidModulik1.module;
      } catch (e) {
        assert.deepStrictEqual(e.message, 'Module exited unexpectedly');
        return;
      }
      throw new Error('Module did not throw');
    })();
    await (async () => {
      try {
        await invalidModulik2.module;
      } catch (e) {
        assert.deepStrictEqual(e.message, 'Module exited unexpectedly');
        return;
      }
      throw new Error('Module did not throw');
    })();
  });

  [
    {
      modulePath: './resources/number-module.js',
      expectedMessage: 'Ready.',
      logLevel: 'info',
      reason: 'module is accessible',
      reducer: (acc, modulikInstance) => acc.then(() => modulikInstance.module),
    },
    {
      modulePath: './resources/throwing-module.js',
      expectedMessage: 'Exited unexpectedly',
      logLevel: 'error',
      reason: 'module is accessible',
      reducer: (acc, modulikInstance) =>
        acc.then(() => modulikInstance.module.catch(() => {})),
    },
  ].forEach(({ modulePath, expectedMessage, logLevel, reason, reducer }) => {
    it(`logs "${expectedMessage}" to the console when ${reason}`, async () => {
      const spy = spyOn(console, logLevel);
      scheduler.add(() => {
        spy.free();
      });

      await [
        modulik(modulePath),
        modulik({
          path: modulePath,
        }),
        modulik(modulePath, {
          disabled: true,
        }),
        modulik({
          path: modulePath,
          disabled: true,
        }),
      ]
        .map(modulikInstance => {
          scheduler.add(async () => {
            await modulikInstance.kill();
          });
          return modulikInstance;
        })
        .reduce(reducer, Promise.resolve())
        .then(() => {
          assert.deepStrictEqual(spy.calls.length, 4);
          spy.calls.forEach(([msg]) => {
            assert.deepStrictEqual(msg.includes(expectedMessage), true);
          });
        });
    });
  });

  it('disables logging when quiet property of options is set to true', async () => {
    const spy = spyOn(console, 'info');
    scheduler.add(() => {
      spy.free();
    });

    await [
      modulik('./resources/number-module.js', {
        quiet: true,
      }),
      modulik({
        path: './resources/number-module.js',
        quiet: true,
      }),
      modulik('./resources/number-module.js', {
        disabled: true,
        quiet: true,
      }),
      modulik({
        disabled: true,
        path: './resources/number-module.js',
        quiet: true,
      }),
    ]
      .map(modulikInstance => {
        scheduler.add(async () => {
          await modulikInstance.kill();
        });
        return modulikInstance;
      })
      .reduce(
        (acc, modulikInstance) => acc.then(() => modulikInstance.module),
        Promise.resolve(),
      )
      .then(() => {
        assert.deepStrictEqual(spy.calls.length, 0);
      });
  });

  it('restarts module when "restart" method was invoked', async () => {
    const fsArtifactPath = path.resolve(__dirname, 'resources/fs-artifact.txt');
    await deleteFileAndWait(fsArtifactPath);
    const moduleWatched = modulik('./resources/fs-module');
    scheduler.add(async () => {
      await deleteFileAndWait(fsArtifactPath);
      await moduleWatched.kill();
    });

    await moduleWatched.module;
    await deleteFileAndWait(fsArtifactPath);
    await moduleWatched.restart();
    await moduleWatched.module;

    assert.deepStrictEqual(existsSync(fsArtifactPath), true);
  });

  it('restarts module on changes to the file', async () => {
    const fsArtifactPath = path.resolve(__dirname, 'resources/fs-artifact.txt');
    const modulePath = path.resolve(__dirname, 'resources/fs-module.js');
    const moduleContent = readFileSync(modulePath, 'utf-8');
    const moduleWatched = modulik(modulePath);
    scheduler.add(async () => {
      await deleteFileAndWait(fsArtifactPath);
      await moduleWatched.kill();
      await writeFileAndWait(modulePath, moduleContent);
    });

    await moduleWatched.module;
    await deleteFileAndWait(fsArtifactPath);
    await writeFileAndWait(modulePath, `${moduleContent}\n`);
    await moduleWatched.module;

    assert.deepStrictEqual(existsSync(fsArtifactPath), true);
  });

  [
    {
      watchItem: './resources/nested/module.js',
      name: 'relative path',
    },
    {
      watchItem: path.resolve(__dirname, 'resources/nested/module.js'),
      name: 'absolute path',
    },
    {
      watchItem: './resources/nested',
      name: 'directory path',
    },
    // {
    //   watchItem: './resources/nested/*.js',
    //   name: 'glob',
    // },
  ].forEach(({ watchItem, name }) => {
    it(`restarts module on changes to watched files when watching on ${name}`, async () => {
      const fsArtifactPath = path.resolve(
        __dirname,
        'resources/fs-artifact.txt',
      );
      const modulePath = path.resolve(__dirname, 'resources/nested/module.js');
      const moduleContent = readFileSync(modulePath, 'utf-8');

      const moduleWatched = modulik('./resources/fs-module.js', {
        watch: [watchItem],
      });
      scheduler.add(async () => {
        await deleteFileAndWait(fsArtifactPath);
        await moduleWatched.kill();
        await writeFileAndWait(modulePath, moduleContent);
      });

      await moduleWatched.module;
      await deleteFileAndWait(fsArtifactPath);
      await writeFileAndWait(modulePath, `${moduleContent}\n`);
      await moduleWatched.module;

      assert.deepStrictEqual(existsSync(fsArtifactPath), true);
    });
  });

  it('disables watching and restarting when disable option is set to true', async () => {
    const fsArtifactPath = path.resolve(__dirname, 'resources/fs-artifact.txt');
    const modulePath = path.resolve(__dirname, 'resources/fs-module.js');
    const moduleContent = readFileSync(modulePath, 'utf-8');
    const moduleWatched1 = modulik(modulePath, { disabled: true });
    scheduler.add(async () => {
      await deleteFileAndWait(fsArtifactPath);
      await moduleWatched1.kill();
      await writeFileAndWait(modulePath, moduleContent);
    });

    await moduleWatched1.module;
    await deleteFileAndWait(fsArtifactPath);
    await writeFileAndWait(modulePath, `${moduleContent}\n`);
    await moduleWatched1.module;

    assert.deepStrictEqual(existsSync(fsArtifactPath), false);

    const moduleWatched2 = modulik({ path: modulePath, disabled: true });
    scheduler.add(async () => {
      await moduleWatched2.kill();
    });

    await moduleWatched2.module;
    await deleteFileAndWait(fsArtifactPath);
    await writeFileAndWait(modulePath, moduleContent);
    await moduleWatched2.module;
    assert.deepStrictEqual(existsSync(fsArtifactPath), false);
  });

  it('causes module to stop watching for changes when "kill" method was invoked', async () => {
    const fsArtifactPath = path.resolve(__dirname, 'resources/fs-artifact.txt');
    const modulePath = path.resolve(__dirname, 'resources/fs-module.js');
    const moduleContent = readFileSync(modulePath, 'utf-8');
    const moduleWatched = modulik(modulePath);
    scheduler.add(async () => {
      await deleteFileAndWait(fsArtifactPath);
      await moduleWatched.kill();
      await writeFileAndWait(modulePath, moduleContent);
    });
    await moduleWatched.module;
    await deleteFileAndWait(fsArtifactPath);

    await moduleWatched.kill();
    await writeFileAndWait(modulePath, `${moduleContent}\n`);
    await moduleWatched.module;

    assert.deepStrictEqual(existsSync(fsArtifactPath), false);
  });

  it('allows to call "restart" method even when disabled option is set to true', async () => {
    const moduleWatched = modulik('./resources/number-module.js', {
      disabled: true,
    });
    scheduler.add(async () => {
      await moduleWatched.kill();
    });
    await moduleWatched.restart();
    await moduleWatched.module;
  });

  it('allows to call "restart" method even when module is already killed', async () => {
    const moduleWatched = modulik('./resources/number-module');
    await moduleWatched.kill();
    await moduleWatched.restart();
  });

  it('emits "restart" event when restart happens', async () => {
    const numberModulik = modulik('./resources/number-module');
    scheduler.add(async () => {
      await numberModulik.kill();
    });
    let emitted = false;
    numberModulik.on('restart', () => {
      emitted = true;
    });
    await numberModulik.module;
    await numberModulik.restart();
    assert.deepStrictEqual(emitted, true);
  });

  it('emits "ready" event when module is ready', async () => {
    const numberModulik = modulik('./resources/number-module');
    scheduler.add(async () => {
      await numberModulik.kill();
    });
    let emitted = false;
    numberModulik.on('ready', () => {
      emitted = true;
    });
    await numberModulik.module;
    assert.deepStrictEqual(emitted, true);
  });

  it('emits "failed" event with error object when module failed', async () => {
    const numberModulik = modulik('./resources/trowing-module');
    scheduler.add(async () => {
      await numberModulik.kill();
    });
    let emittedError = null;
    let thrownError = null;
    numberModulik.on('failed', error => {
      emittedError = error;
    });
    try {
      await numberModulik.module;
    } catch (e) {
      thrownError = e;
    }
    assert.deepStrictEqual(emittedError instanceof Error, true);
    assert.deepStrictEqual(emittedError === thrownError, true);
    assert.deepStrictEqual(emittedError.message, 'Module exited unexpectedly');
  });
});
