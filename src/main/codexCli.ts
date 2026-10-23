import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, constants, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const SESSION_FILE = 'codex-question-session.json';
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const TURN_TIMEOUT_MS = 180_000;

export type CodexCliIssue = 'cliMissing' | 'signIn' | 'sessionMissing' | 'failed';

export class CodexCliError extends Error {
  constructor(readonly issue: CodexCliIssue) {
    super(issue);
    this.name = 'CodexCliError';
  }
}

interface CliResult {
  answer: string;
  sessionId: string | null;
}

function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function messageText(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null;
  const root = event as { type?: unknown; item?: unknown };
  if (root.type !== 'item.completed' || !root.item || typeof root.item !== 'object') return null;
  const item = root.item as { type?: unknown; text?: unknown; content?: unknown };
  if (item.type !== 'agent_message') return null;
  if (typeof item.text === 'string') return item.text;
  if (!Array.isArray(item.content)) return null;
  const chunks = item.content.flatMap((part: unknown) => {
    if (!part || typeof part !== 'object') return [];
    const text = (part as { text?: unknown }).text;
    return typeof text === 'string' ? [text] : [];
  });
  return chunks.length ? chunks.join('\n') : null;
}

function eventResults(stdout: string): { sessionId: string | null; answer: string | null } {
  let sessionId: string | null = null;
  let answer: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const event: unknown = JSON.parse(line);
      if (!event || typeof event !== 'object') continue;
      const root = event as { type?: unknown; thread_id?: unknown; threadId?: unknown };
      if (root.type === 'thread.started') {
        const id = root.thread_id ?? root.threadId;
        if (isSessionId(id)) sessionId = id;
      }
      answer = messageText(event) ?? answer;
    } catch {
      // Startup warnings are plain text; JSON events carry the thread ID and final message.
    }
  }
  return { sessionId, answer };
}

async function isFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function findCodexCli(): Promise<string | null> {
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const binRoot = join(localAppData, 'OpenAI', 'Codex', 'bin');
      try {
        const versions = await readdir(binRoot, { withFileTypes: true });
        const paths = versions.filter((item) => item.isDirectory()).map((item) => join(binRoot, item.name, 'codex.exe'));
        const installed = await Promise.all(paths.map(async (path) => ({ path, modified: (await stat(path).catch(() => null))?.mtimeMs ?? 0 })));
        candidates.push(...installed.sort((a, b) => b.modified - a.modified).map((item) => item.path));
      } catch {
        // The app may be installed elsewhere or exposed through PATH.
      }
    }
    candidates.push(join(homedir(), '.local', 'bin', 'codex.exe'));
    for (const directory of (process.env.PATH ?? '').split(delimiter)) {
      if (directory) candidates.push(join(directory, 'codex.exe'));
    }
  } else {
    candidates.push(join(homedir(), '.local', 'bin', 'codex'), join(homedir(), '.codex', 'bin', 'codex'));
    if (process.platform === 'darwin') candidates.push('/Applications/Codex.app/Contents/Resources/codex');
    for (const directory of (process.env.PATH ?? '').split(delimiter)) {
      if (directory) candidates.push(join(directory, 'codex'));
    }
  }
  for (const path of candidates) {
    if (!await isFile(path)) continue;
    if (process.platform === 'win32' || await access(path, constants.X_OK).then(() => true).catch(() => false)) return path;
  }
  return null;
}

function classifyFailure(stderr: string, sessionId: string | null): CodexCliError {
  if (sessionId && /session.{0,40}(not found|does not exist|could not be loaded)|(?:failed to load|could not load) session|no session found/i.test(stderr)) {
    return new CodexCliError('sessionMissing');
  }
  if (/not logged in|unauthori[sz]ed|sign[ -]?in required|authentication required|log in to codex/i.test(stderr)) {
    return new CodexCliError('signIn');
  }
  return new CodexCliError('failed');
}

/** Both CLI forms need the trust bypass because screenshots run from a temporary, non-repository directory. */
export function codexExecArgs(
  sessionId: string | null, imagePath: string, answerPath: string, workspace: string, prompt: string, deep = false,
): string[] {
  const modelArgs = ['--model', 'gpt-6-luna', '--config', `model_reasoning_effort=${deep ? 'high' : 'low'}`];
  if (sessionId) {
    return [
      'exec', 'resume', ...modelArgs, '--json', '--image', imagePath, '--output-last-message', answerPath,
      '--ignore-user-config', '--skip-git-repo-check', sessionId, prompt,
    ];
  }
  return [
    'exec', ...modelArgs, '--json', '--image', imagePath, '--sandbox', 'read-only', '--cd', workspace,
    '--skip-git-repo-check', '--output-last-message', answerPath, '--ignore-user-config', prompt,
  ];
}

/** Runs Codex CLI turns in one persistent, isolated screenshot-question session. */
export class CodexCli {
  private executable: Promise<string | null> | null = null;
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly sessionPath: string;
  private readonly workspace = join(tmpdir(), 'lolping-codex-questions');
  private readonly codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
  private loginCheckedAt = 0;
  private loginState = false;
  private loginCheck: Promise<boolean> | null = null;

  constructor(private readonly directory: string) {
    this.sessionPath = join(directory, SESSION_FILE);
  }

  async available(): Promise<boolean> {
    this.executable ??= findCodexCli();
    return (await this.executable) !== null;
  }

  async signedIn(): Promise<boolean> {
    this.executable ??= findCodexCli();
    const executable = await this.executable;
    if (!executable) return false;
    if (this.loginCheck) return this.loginCheck;
    if (Date.now() - this.loginCheckedAt < 30_000) return this.loginState;
    const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: this.codexHome };
    delete env.ELECTRON_RUN_AS_NODE;
    this.loginCheck = new Promise<boolean>((resolve) => {
      execFile(executable, ['login', 'status'], { env, timeout: 5000, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
        this.loginCheckedAt = Date.now();
        // Codex CLI writes its successful login status to stderr on Windows.
        // Check both streams, and require an affirmative status so "not logged in" cannot match.
        const status = `${stdout}\n${stderr}`;
        this.loginState = !error && /(?:^|\r?\n)\s*logged in(?:\s+(?:using|as)\b|[.!]?\s*$)/im.test(status);
        resolve(this.loginState);
      });
    }).finally(() => { this.loginCheck = null; });
    return this.loginCheck;
  }

  async ask(image: Buffer, prompt: string, deep = false, timeoutMs = TURN_TIMEOUT_MS): Promise<string> {
    this.executable ??= findCodexCli();
    const executable = await this.executable;
    if (!executable) throw new CodexCliError('cliMissing');

    await mkdir(this.directory, { recursive: true });
    await mkdir(this.workspace, { recursive: true });
    const temporary = await mkdtemp(join(tmpdir(), 'lolping-question-'));
    const imagePath = join(temporary, 'marked-area.jpg');
    const answerPath = join(temporary, 'answer.txt');
    try {
      await writeFile(imagePath, image, { mode: 0o600 });
      let sessionId = await this.readSessionId();
      let result: CliResult;
      try {
        result = await this.run(executable, sessionId, imagePath, answerPath, prompt, deep, timeoutMs);
      } catch (error) {
        if (!(error instanceof CodexCliError) || error.issue !== 'sessionMissing') throw error;
        sessionId = null;
        await rm(this.sessionPath, { force: true });
        result = await this.run(executable, null, imagePath, answerPath, prompt, deep, timeoutMs);
      }

      const effectiveSessionId = result.sessionId ?? sessionId;
      if (!effectiveSessionId) throw new CodexCliError('failed');
      await this.saveSessionId(effectiveSessionId);
      const answer = await readFile(answerPath, 'utf8').catch(() => result.answer ?? '');
      if (!answer.trim()) throw new CodexCliError('failed');
      return answer.trim();
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  stop(): void {
    this.child?.kill();
  }

  private async run(executable: string, sessionId: string | null, imagePath: string, answerPath: string, prompt: string,
    deep: boolean, timeoutMs: number): Promise<CliResult> {
    const args = codexExecArgs(sessionId, imagePath, answerPath, this.workspace, prompt, deep);
    const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: this.codexHome };
    delete env.ELECTRON_RUN_AS_NODE;

    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(executable, args, { cwd: this.workspace, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      this.child = child;
      child.stdin.end();
      let output = '';
      let stderr = '';
      let overflow = false;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
        if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) {
          overflow = true;
          child.kill();
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-16_384);
      });
      child.once('error', () => {
        clearTimeout(timer);
        if (this.child === child) this.child = null;
        reject(new CodexCliError('failed'));
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (this.child === child) this.child = null;
        if (timedOut || overflow || code !== 0) return reject(classifyFailure(stderr, sessionId));
        resolve(output);
      });
    });
    const events = eventResults(stdout);
    return { answer: events.answer ?? '', sessionId: events.sessionId };
  }

  private async readSessionId(): Promise<string | null> {
    try {
      const value: unknown = JSON.parse(await readFile(this.sessionPath, 'utf8'));
      if (value && typeof value === 'object' && isSessionId((value as { sessionId?: unknown }).sessionId)) {
        return (value as { sessionId: string }).sessionId;
      }
    } catch {
      // A missing or malformed session marker starts a fresh dedicated conversation.
    }
    return null;
  }

  private async saveSessionId(sessionId: string): Promise<void> {
    const temporary = `${this.sessionPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ sessionId }), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.sessionPath);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
