import { describe, expect, it } from 'vitest';
import { codexExecArgs } from '../../src/main/codexCli';

describe('codexExecArgs', () => {
  it('uses high reasoning only for a requested deep analysis, including resumed turns', () => {
    for (const session of [null, 'session-id']) {
      expect(codexExecArgs(session, 'i', 'a', 'w', 'q')).toContain('model_reasoning_effort=low');
      expect(codexExecArgs(session, 'i', 'a', 'w', 'q', true)).toContain('model_reasoning_effort=high');
    }
  });
  it('allows an image question to start outside a Git repository', () => {
    const args = codexExecArgs(null, 'image.jpg', 'answer.txt', 'temporary-workspace', 'question');
    expect(args[0]).toBe('exec');
    expect(args).toContain('--skip-git-repo-check');
    expect(args).toContain('--sandbox');
    expect(args).toContain('read-only');
  });

  it('keeps the temporary-directory allowance when resuming the same conversation', () => {
    const args = codexExecArgs('session-id', 'image.jpg', 'answer.txt', 'temporary-workspace', 'question');
    expect(args.slice(0, 2)).toEqual(['exec', 'resume']);
    expect(args).toContain('--skip-git-repo-check');
    expect(args).toContain('--image');
    expect(args.slice(-2)).toEqual(['session-id', 'question']);
  });
});
