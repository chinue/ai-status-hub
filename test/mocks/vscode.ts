// Minimal vscode API stub for unit tests.
// Only implements surface area touched by v2 modules.

export class MemorySecretStorage {
  private data = new Map<string, string>();
  async get(key: string): Promise<string | undefined> { return this.data.get(key); }
  async store(key: string, value: string): Promise<void> { this.data.set(key, value); }
  async delete(key: string): Promise<void> { this.data.delete(key); }
  keys(): Promise<string[]> { return Promise.resolve(Array.from(this.data.keys())); }
  onDidChange = (_listener: any, _thisArgs?: any, _disposables?: any[]) => ({ dispose: () => {} });
}

export class MemoryMemento {
  private data = new Map<string, unknown>();
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.data.has(key) ? (this.data.get(key) as T) : defaultValue;
  }
  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.data.delete(key);
    else this.data.set(key, value);
  }
}

export const Uri = {
  file: (path: string) => ({ fsPath: path, path, scheme: 'file' })
};

export const StatusBarAlignment = { Left: 1, Right: 2 };

export class MarkdownString {
  value = '';
  isTrusted = false;
  appendMarkdown(value: string): this { this.value += value; return this; }
}

export class ThemeColor {
  constructor(public id: string) {}
}

export const window = {
  createStatusBarItem: (_alignment?: number, _priority?: number) => {
    const item = {
      text: '', tooltip: '', color: undefined, backgroundColor: undefined,
      command: undefined, name: '', visible: false,
      show: () => { item.visible = true; },
      hide: () => { item.visible = false; },
      dispose: () => {}
    };
    return item;
  },
  createOutputChannel: (_name: string) => ({
    appendLine: () => {}, append: () => {}, clear: () => {}, show: () => {}, hide: () => {}, dispose: () => {}
  }),
  createWebviewPanel: (_viewType: string, _title: string, _showOptions?: any, _options?: any) => ({
    webview: { html: '', postMessage: () => {}, onDidReceiveMessage: () => ({ dispose: () => {} }) },
    visible: false,
    reveal: () => {},
    onDidDispose: () => ({ dispose: () => {} }),
    dispose: () => {},
  }),
  showInformationMessage: () => Promise.resolve(undefined),
  showWarningMessage: () => Promise.resolve(undefined),
  showErrorMessage: () => Promise.resolve(undefined),
  showInputBox: () => Promise.resolve(undefined),
};

export const workspace = {
  getConfiguration: (section?: string) => ({
    get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
    update: () => Promise.resolve(),
  }),
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
};

export const env = { language: 'en' };

export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: () => Promise.resolve(),
};

export const ViewColumn = { Beside: -2 };

export type SecretStorage = MemorySecretStorage;

export function makeContext(initial?: Record<string, unknown>) {
  const globalState = new MemoryMemento();
  if (initial) {
    for (const [k, v] of Object.entries(initial)) {
      void globalState.update(k, v);
    }
  }
  return {
    secrets: new MemorySecretStorage(),
    globalState,
    subscriptions: [] as Array<{ dispose: () => void }>,
    extensionUri: Uri.file('/tmp/ext'),
    globalStorageUri: Uri.file('/tmp/globalStorage'),
  };
}
