// Vinext 1.0.0-beta.5 calls process.exit(0) immediately after export while its
// prerender sockets are still closing. On Windows this can abort in libuv's
// async handle cleanup. Let successful builds drain their event loop instead;
// preserve every other exit request, including undefined and nonzero codes.
if (process.platform === 'win32') {
  const exit = process.exit;
  process.exit = function exitAfterCleanup(code) {
    if (code === 0) { process.exitCode = 0; return; }
    // Node distinguishes process.exit() from process.exit(undefined), so keep
    // the original argument count as well as its values.
    return exit.apply(process, arguments);
  };
}
