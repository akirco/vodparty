import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Registers the bundler-style resolver for `node --test` runs.
register('./ts-resolve.mjs', pathToFileURL(import.meta.filename ?? './'));
