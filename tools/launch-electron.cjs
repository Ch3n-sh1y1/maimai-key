/**
 * Launches Electron with a clean environment.
 *
 * Some shells (including the DSH harness) export ELECTRON_RUN_AS_NODE=1,
 * which turns the Electron binary into plain Node and makes the main process
 * fail on `require('electron').ipcMain`. Strip it before spawning.
 */
const { spawn } = require('node:child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = process.argv.slice(2);
const child = spawn(electronPath, args.length > 0 ? args : ['.'], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
