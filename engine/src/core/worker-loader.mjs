// Resolve the ESM loader from the bundled runtime, including when the caller
// is a CommonJS extension or its host does not support synchronous hooks.
import { register } from 'tsx/esm/api';
register();
