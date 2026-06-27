import { postMessage } from '../capabilities/slack';
import { getNotifyConfig } from './config';
import { log } from './log';

const LOG_MOD = 'notify';
const JST_TIME_ZONE = 'Asia/Tokyo';

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
 * Slackエラー専用チャンネルへ通知を送る。通知自体が失敗した場合は log.error で記録して握りつぶす。
 * @param params 通知パラメータ（severity, job, message, context?, err?）
 * @returns なし
 */
export function notifySlack(params: NotifyParams): void {
  try {
    const cfg = getNotifyConfig();
    const text = formatMessage(params);
    postMessage(cfg.slackBotToken, cfg.slackErrorChannelId, { text });
  } catch (err) {
    log.error(LOG_MOD, 'slack notify failed', err);
  }
}

function formatMessage(params: NotifyParams): string {
  const timestamp = Utilities.formatDate(new Date(), JST_TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');
  const prefix = params.severity === 'error' ? '<!channel> ' : '';
  const icon = params.severity === 'error' ? ':rotating_light:' : ':warning:';
  const label = params.severity.toUpperCase();

  const lines: string[] = [
    `${prefix}${icon} *[${label}] ${params.job}*`,
    `> ${params.message}`,
    '',
    `*Time:* ${timestamp} JST`,
  ];

  if (params.context) {
    lines.push(`*Context:* \`${JSON.stringify(params.context)}\``);
  }

  if (params.err !== undefined) {
    const errStr =
      params.err instanceof Error
        ? `${params.err.name}: ${params.err.message}${params.err.stack ? `\n${params.err.stack}` : ''}`
        : String(params.err);
    lines.push(`*Error:* \`\`\`${errStr}\`\`\``);
  }

  return lines.join('\n');
}
