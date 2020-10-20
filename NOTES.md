 * add test coverage for a case when there is module without extension provided and there is no matching file in the fs with the provided name and one of allowed extensions - it throws first but restarts and works when in the fs a file with specified name and one of allowed extension appears.
 * add test coverage for matchin one of the supported by default extensions.
 * should the jsx extension be supported by default? Is it possible to import jsx file as a module? (not considering jsx file to be watched). Node runtime will not be able to process jsx code. Enabling this possibility via using @babel/register requires attaching it at the requestor level.
   * as a fix for that issue it is possible to take an mocha's approach which is an "require" option allowing to load additional modules before the main module will be loaded. Module(s) specified with "require" option won't be watched for changes.
 * ensure there is a test for a case when module was a function and was accessible, then restart happen and before module got available back there where invocations buffered. After new module gets available and it is not a function then all buffered invocations have to be rejected/cleared
 * there is a issue when the restart method will be called two times without waiting for returned promise to be resolved. The problem here is that logger will log "restarting" twice and a "onRestart" callback will be executed twice also. Consider adding to the "restartChild" a check for a state starting and eventually just return;
 * consider moving logger outside "launchWatcher"
 * make "moduleKilled" flag one of a states
 * should module be restarted if the module file has been deleted?
 * test (compare) errors between disabled and not
 * test whether is able to run module without extension
