// Runs the service against the fake servers, for trying the app's screens. Not a test.
import { install, env } from './fake.js';
env();
process.env.PORT = process.env.PORT || '8095';
process.env.DATA_DIR = process.env.DATA_DIR || '/tmp/scrappy-requests-mock';
install();
await import('../src/server.js');
