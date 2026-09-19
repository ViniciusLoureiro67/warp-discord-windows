#!/usr/bin/env node
import('../dist/cli.js')
  .then((cli) => cli.main(process.argv.slice(2)))
  .catch((error) => {
    if (error && error.code === 'ERR_MODULE_NOT_FOUND') {
      console.error('warp-discord-windows is not built yet. Run "npm run build" first.');
    } else {
      console.error(error);
    }
    process.exit(1);
  });
