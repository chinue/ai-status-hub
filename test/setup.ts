import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(import.meta.url);
const mockPath = path.resolve(__dirname, 'mocks/vscode.ts');
const originalResolve = (require('module') as any)._resolveFilename;

(require('module') as any)._resolveFilename = function (request: string, parent: any, ...rest: any[]) {
  if (request === 'vscode') return mockPath;
  return originalResolve.call(this, request, parent, ...rest);
};
