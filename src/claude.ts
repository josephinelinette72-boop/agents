/**
 * Calling Claude Code's command line, which runs on a Claude plan (Pro/Max)
 * instead of an API key.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

/** The `claude` binary: CLAUDE_BIN, then PATH, then the copy bundled with the VS Code extension. */
export function findClaude(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const fromEnv = env.CLAUDE_BIN?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const onPath = spawnSync('sh', ['-c', 'command -v claude'], { encoding: 'utf8' }).stdout.trim();
  if (onPath) return onPath;
  for (const candidate of [path.join(homedir(), '.local', 'bin', 'claude'), path.join(homedir(), '.claude', 'local', 'claude')]) {
    if (existsSync(candidate)) return candidate;
  }
  for (const root of [path.join(homedir(), '.vscode-server', 'extensions'), path.join(homedir(), '.vscode', 'extensions')]) {
    if (!existsSync(root)) continue;
    const versions = readdirSync(root)
      .filter((d) => d.startsWith('anthropic.claude-code-'))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) {
      const bin = path.join(root, v, 'resources', 'native-binary', 'claude');
      if (existsSync(bin)) return bin;
    }
  }
  return undefined;
}

/**
 * One structured answer from Claude Code with no tools at all: a pure
 * judgment call. Returns the object that matches `schema`.
 */
export async function claudeJson<T>(input: { systemPrompt: string; prompt: string; schema: object; timeoutMs?: number }): Promise<T> {
  const bin = findClaude();
  if (!bin) throw new Error('Claude Code is not installed or not on PATH. Set CLAUDE_BIN to the claude binary.');
  const args = [
    '-p',
    '--output-format', 'json',
    '--tools', '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--system-prompt', input.systemPrompt,
    // Claude Code rejects the "$schema" header that zod adds.
    '--json-schema', JSON.stringify({ ...input.schema, $schema: undefined }),
  ];
  return new Promise<T>((resolve, reject) => {
    // Run from a neutral folder so no project settings or agents load.
    const child = spawn(bin, args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Claude Code did not answer in time.'));
    }, input.timeoutMs ?? 240_000);
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(out) as { is_error?: boolean; result?: string; structured_output?: T };
        if (result.is_error || result.structured_output === undefined) {
          reject(new Error(`Claude Code returned no answer: ${(result.result ?? err).slice(0, 300)}`));
        } else {
          resolve(result.structured_output);
        }
      } catch {
        reject(new Error(`Claude Code exited with code ${code}: ${(err || out).slice(0, 300)}`));
      }
    });
    child.stdin.end(input.prompt);
  });
}
