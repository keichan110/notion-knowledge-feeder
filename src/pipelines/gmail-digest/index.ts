import { getMessagePlainBody, getThreadPermalink, searchThreads } from '../../capabilities/gmail';
import { postMessage } from '../../capabilities/slack';
import { getGmailDigestConfig } from '../../lib/config';
import { log } from '../../lib/log';

const CHUNK_SIZE = 10;
const DIGEST_LABEL = 'newsletter';
const LOG_MOD = 'gmail-digest';

export type YesterdayWindow = { after: string; before: string };
export type ParsedFrom = { name: string; email: string };

/**
 * 指定時刻を基準にJSTで前日分のGmail検索日付範囲を返す。
 * @param now 基準時刻
 * @returns Gmail検索クエリに渡すafter/before日付
 */
export function getYesterdayWindow(now: Date): YesterdayWindow {
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
  const todayJst = new Date(
    Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate())
  );
  const yesterdayJst = new Date(todayJst.getTime() - 24 * 60 * 60 * 1000);
  return { after: fmtDate(yesterdayJst), before: fmtDate(todayJst) };
}

/**
 * 本文テキストのホワイトスペースを正規化し、指定文字数でトリムする。
 * @param body プレーンテキストの本文
 * @param maxLen トリムする最大文字数（デフォルト: 200）
 * @returns 正規化・トリム済みの本文冒頭
 */
export function truncateBody(body: string, maxLen = 200): string {
  const normalized = body.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen)}…`;
}

/**
 * GmailのFrom文字列を表示名とメールアドレスに分離する。
 * @param from GmailMessage.getFrom() が返すFrom文字列
 * @returns 表示名とメールアドレス
 */
export function parseFrom(from: string): ParsedFrom {
  const match = from.match(/^(.*)<([^<>]+)>$/);
  if (!match) return { name: '', email: from };

  const name = stripSurroundingDoubleQuotes(match[1].trim());
  return { name, email: match[2].trim() };
}

/**
 * 前日のNewsletterメールを検索し、件名・送信者・本文冒頭をSlackスレッドへ投稿する。
 * @returns なし
 */
export function runGmailDigest(): void {
  const cfg = getGmailDigestConfig();
  const { after, before } = getYesterdayWindow(new Date());
  log.info(LOG_MOD, 'start', { after, before, label: DIGEST_LABEL });
  let threads: GoogleAppsScript.Gmail.GmailThread[];
  try {
    threads = searchThreads(`label:${DIGEST_LABEL} after:${after} before:${before}`);
  } catch (err) {
    log.error(LOG_MOD, 'gmail search failed', err);
    throw err;
  }
  const parentMessage = buildParentSlackMessage(after, threads.length);
  try {
    const parentTs = postMessage(cfg.slackBotToken, cfg.slackChannelId, parentMessage);
    for (const threadChunk of chunk(threads, CHUNK_SIZE)) {
      postMessage(cfg.slackBotToken, cfg.slackChannelId, {
        text: buildThreadFallbackText(after, threadChunk),
        blocks: buildThreadReplyBlocks(threadChunk),
        threadTs: parentTs,
      });
    }
  } catch (err) {
    log.error(LOG_MOD, 'slack post failed', err);
    throw err;
  }
  log.info(LOG_MOD, 'done', { count: threads.length });
}

/**
 * DateをGmail検索用の日付文字列に変換する。
 * @param date 変換対象日付
 * @returns `yyyy/MM/dd` 形式の日付文字列
 */
function fmtDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

/**
 * 親Slackメッセージを組み立てる。
 * @param after 対象日付
 * @param count Newsletter件数
 * @returns Slack投稿パラメータ
 */
function buildParentSlackMessage(
  after: string,
  count: number
): {
  text: string;
  blocks: unknown[];
} {
  const escapedAfter = escapeMrkdwn(after);
  const summary =
    count === 0
      ? `*${escapedAfter}* ・ Newsletterは届きませんでした`
      : `*${escapedAfter}* ・ ${count}件`;

  return {
    text: `📬 昨日のNewsletter\n${summary}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '📬 昨日のNewsletter', emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: summary },
      },
    ],
  };
}

/**
 * スレッド返信のBlock Kit blocksを組み立てる。
 * @param threads ダイジェスト対象のGmailスレッド配列
 * @returns Slack Block Kit blocks
 */
function buildThreadReplyBlocks(threads: GoogleAppsScript.Gmail.GmailThread[]): unknown[] {
  return threads.flatMap((thread) => {
    const msg = thread.getMessages()[0];
    const from = parseFrom(msg.getFrom());
    const body = escapeMrkdwn(truncateBody(getMessagePlainBody(msg), 200));
    const subject = escapeMrkdwn(msg.getSubject());
    const sender = buildSenderText(from);

    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${subject}*\n${body}` },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'メールを開く', emoji: true },
          url: getThreadPermalink(thread),
        },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: sender }],
      },
      { type: 'divider' },
    ];
  });
}

/**
 * スレッド返信の通知フォールバック本文を組み立てる。
 * @param after 対象日付
 * @param threads ダイジェスト対象のGmailスレッド配列
 * @returns Slack通知フォールバック本文
 */
function buildThreadFallbackText(
  after: string,
  threads: GoogleAppsScript.Gmail.GmailThread[]
): string {
  const subjects = threads
    .map((thread) => escapeMrkdwn(thread.getMessages()[0].getSubject()))
    .join(', ');
  return `📬 昨日のNewsletter ${escapeMrkdwn(after)} 詳細: ${subjects}`;
}

/**
 * 送信者表示のmrkdwnを組み立てる。
 * @param from パース済みFrom
 * @returns エスケープ済みの送信者表示
 */
function buildSenderText(from: ParsedFrom): string {
  const email = escapeMrkdwn(from.email);
  if (!from.name) return email;
  return `*${escapeMrkdwn(from.name)}* &lt;${email}&gt;`;
}

/**
 * Slack mrkdwn用に特殊文字をエスケープする。
 * @param s エスケープ対象文字列
 * @returns エスケープ済み文字列
 */
function escapeMrkdwn(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 配列を指定サイズで分割する。
 * @param arr 分割対象配列
 * @param size チャンクサイズ
 * @returns 分割済み配列
 */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * 前後のダブルクォートを取り除く。
 * @param s 対象文字列
 * @returns ダブルクォート除去後の文字列
 */
function stripSurroundingDoubleQuotes(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}
