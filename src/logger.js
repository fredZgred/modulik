const createLogger = (moduleName, quiet) => {
  const makeMethod = loggingFunction => message => {
    if (quiet) return;
    loggingFunction(`[modulik]: ${moduleName} - ${message}`);
  };
  return {
    info: makeMethod(console.info),
    error: makeMethod(console.error),
  };
};

module.exports = createLogger;
