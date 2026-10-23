import type { Strings } from './i18n';
import type { AssistantIssue } from './ipc';

/** Converts typed request failures to localized text without exposing service error bodies. */
export function assistantIssueText(issue: AssistantIssue | undefined, t: Strings): string {
  switch (issue) {
    case 'codexClosed': return t.questionIssueCodex;
    case 'codexCliMissing': return t.questionIssueCodexCli;
    case 'codexSignIn': return t.questionIssueCodexSignIn;
    case 'codexFailed': return t.questionIssueCodexFailed;
    case 'captureFailed': return t.questionIssueCapture;
    case 'deepseekKeyMissing': return t.assistantIssueKeyMissing;
    case 'deepseekAuth': return t.assistantIssueAuth;
    case 'deepseekBalance': return t.assistantIssueBalance;
    case 'deepseekRateLimit': return t.assistantIssueRateLimit;
    case 'deepseekTimeout': return t.assistantIssueTimeout;
    case 'deepseekFailed': return t.assistantIssueFailed;
    case 'secureStorage': return t.assistantIssueStorage;
    case 'todoStorage': return t.questionIssueTodoStorage;
    case 'todoLimit': return t.questionIssueTodoLimit;
    case 'sourceUnavailable': return t.questionIssueSources;
    default: return t.questionError;
  }
}
