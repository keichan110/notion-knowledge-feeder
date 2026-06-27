import type { SlackAttachment } from '../capabilities/slack';
import { postMessage } from '../capabilities/slack';
import { getNotifyConfig } from './config';
import { log } from './log';

const LOG_MOD = 'notify';
const JST_TIME_ZONE = 'Asia/Tokyo';
const COLOR_ERROR = '#E01E5A';
const COLOR_WARN = '#ECB22E';
// Slack section block text は 3000 文字制限。マークダウン装飾分を差し引いた安全上限。
const MAX_FIELD_LEN = 2500;

type Severity = 'error' | 'warn';

/** notifySlack に渡すパラメータ。 */
export type NotifyParams = {
  severity: Severity;
  job: string;
  message: string;
  context?: object;
  err?: unknown;
};

/**
 * Slackエラー専用チャンネルへ attachments 形式で通知を送る。通知自体が失敗した場合は log.error で記録して握りつぶす。
 * @param params 通知パラメータ（severity, job, message, context?, err?）
 * @returns なし
 */
export function notifySlack(params: NotifyParams): void {
  try {
    const cfg = getNotifyConfig();
    const { text, attachments } = formatMessage(params);
    postMessage(cfg.slackBotToken, cfg.slackErrorChannelId, { text, attachments });
  } catch (err) {
    log.error(LOG_MOD, 'slack notify failed', err);
  }
}

function formatMessage(params: NotifyParams): { text: string; attachments: SlackAttachment[] } {
  const timestamp = Utilities.formatDate(new Date(), JST_TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');

  const prefix = params.severity === 'error' ? '<!channel> ' : '';
  const label = params.severity.toUpperCase();
  const text = `${prefix}[${label}] ${params.job} — ${params.message}`;

  const color = params.severity === 'error' ? COLOR_ERROR : COLOR_WARN;

  const blocks: unknown[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: truncate(params.message) },
    },
    {
      type: 'section',
      fields: [{ type: 'mrkdwn', text: `*Job*\n${params.job}` }],
    },
  ];

  if (params.context) {
    const raw = JSON.stringify(params.context);
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Context*\n\`\`\`${truncate(raw)}\`\`\`` },
    });
  }

  if (params.err !== undefined) {
    const errStr =
      params.err instanceof Error
        ? `${params.err.name}: ${params.err.message}${params.err.stack ? `\n${params.err.stack}` : ''}`
        : String(params.err);
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Error*\n\`\`\`${truncate(errStr)}\`\`\`` },
    });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `${timestamp} JST` }],
  });

  return { text, attachments: [{ color, blocks }] };
}

function truncate(s: string, max = MAX_FIELD_LEN): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…(truncated)`;
}
