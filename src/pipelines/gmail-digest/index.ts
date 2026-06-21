import { getMessagePlainBody, getThreadPermalink, searchThreads } from '../../capabilities/gmail';
import { postMessage } from '../../capabilities/slack';
import { getGeminiConfig, getGmailDigestConfig } from '../../lib/config';
import { log } from '../../lib/log';
import { type DigestSummary, type NewsletterInput, summarizeNewsletters } from './gemini';

const CHUNK_SIZE = 10;
const DIGEST_LABEL = 'newsletter';
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const LOG_MOD = 'gmail-digest';
// 集計ウィンドウの境界時刻（JST）。トリガーが発火しうる最も早い時刻に合わせて固定する。
const WINDOW_BOUNDARY_HOUR = 7;

export type DigestWindow = { after: number; before: number; dateLabel: string };
export type ParsedFrom = { name: string; email: string };

/**
 * 指定時刻を基準にJSTで前日7時から当日7時までのGmail検索範囲を返す。
 * @param now 基準時刻
 * @returns Gmail検索のepoch秒境界(after/before)と表示用の前日日付ラベル
 */
export function getDigestWindow(now: Date): DigestWindow {
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
  const todayJst = new Date(
    Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate())
  );
  const todayJstMidnightMs = todayJst.getTime() - JST_OFFSET_MS;
  const beforeMs = todayJstMidnightMs + WINDOW_BOUNDARY_HOUR * 60 * 60 * 1000;
  const afterMs = beforeMs - 24 * 60 * 60 * 1000;
  const yesterdayJst = new Date(todayJst.getTime() - 24 * 60 * 60 * 1000);

  return {
    after: Math.floor(afterMs / 1000),
    before: Math.floor(beforeMs / 1000),
    dateLabel: fmtDate(yesterdayJst),
  };
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
 * 前日のNewsletterメールを検索し、Gemini横断要約と件名一覧をSlackへ投稿する。
 * @returns なし
 */
export function runGmailDigest(): void {
  const cfg = getGmailDigestConfig();
  const { after, before, dateLabel } = getDigestWindow(new Date());
  log.info(LOG_MOD, 'start', { after, before, dateLabel, label: DIGEST_LABEL });
  let threads: GoogleAppsScript.Gmail.GmailThread[];
  try {
    threads = searchThreads(`label:${DIGEST_LABEL} after:${after} before:${before}`);
  } catch (err) {
    log.error(LOG_MOD, 'gmail search failed', err);
    throw err;
  }

  let summary: DigestSummary | undefined;
  if (threads.length > 0) {
    try {
      const geminiCfg = getGeminiConfig();
      summary = summarizeNewsletters(
        buildNewsletterInputs(threads),
        geminiCfg.geminiModel,
        geminiCfg.geminiApiKey
      );
    } catch (err) {
      log.error(LOG_MOD, 'gemini summarize failed', err);
      throw err;
    }
  }

  const parentMessage = buildParentSlackMessage(dateLabel, threads.length, summary);
  try {
    const parentTs = postMessage(cfg.slackBotToken, cfg.slackChannelId, parentMessage);
    for (const threadChunk of chunk(threads, CHUNK_SIZE)) {
      postMessage(cfg.slackBotToken, cfg.slackChannelId, {
        text: buildThreadFallbackText(dateLabel, threadChunk),
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
 * @param dateLabel 対象日付
 * @param count Newsletter件数
 * @param summary Geminiで生成した横断要約。未指定の場合は0件文言を返す
 * @returns Slack投稿パラメータ
 */
function buildParentSlackMessage(
  dateLabel: string,
  count: number,
  summary?: DigestSummary
): {
  text: string;
  blocks: unknown[];
} {
  const header = `📬 ${dateLabel} のメールダイジェスト`;
  if (!summary) {
    return {
      text: `${header}\nメールは届きませんでした`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: header, emoji: true },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: 'メールは届きませんでした' },
        },
      ],
    };
  }

  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: header, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${count}件` },
    },
  ];

  if (summary.actionItems.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*⚠️ 対応が必要*\n${summary.actionItems
          .map((item) => `• *${escapeMrkdwn(item.subject)}* — ${escapeMrkdwn(item.reason)}`)
          .join('\n')}`,
      },
    });
  }

  if (summary.categories.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*📊 種類別*\n${summary.categories
          .map((category) => `${escapeMrkdwn(category.label)} ${category.count}件`)
          .join(' / ')}`,
      },
    });
  }

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*📝 まとめ*\n${escapeMrkdwn(summary.overview)}` },
  });

  return {
    text: `${header}\n${count}件`,
    blocks,
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
    const subject = escapeMrkdwn(msg.getSubject());
    const sender = buildSenderText(from);

    return [
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: sender }],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${subject}*` },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'メールを開く', emoji: true },
          url: getThreadPermalink(thread),
        },
      },
      { type: 'divider' },
    ];
  });
}

/**
 * スレッド返信の通知フォールバック本文を組み立てる。
 * @param dateLabel 対象日付
 * @param threads ダイジェスト対象のGmailスレッド配列
 * @returns Slack通知フォールバック本文
 */
function buildThreadFallbackText(
  dateLabel: string,
  threads: GoogleAppsScript.Gmail.GmailThread[]
): string {
  const subjects = threads
    .map((thread) => escapeMrkdwn(thread.getMessages()[0].getSubject()))
    .join(', ');
  return `📬 ${escapeMrkdwn(dateLabel)} のメールダイジェスト 詳細: ${subjects}`;
}

/**
 * Gemini入力用のNewsletter配列をGmailスレッドから組み立てる。
 * @param threads ダイジェスト対象のGmailスレッド配列
 * @returns Newsletter入力配列
 */
function buildNewsletterInputs(threads: GoogleAppsScript.Gmail.GmailThread[]): NewsletterInput[] {
  return threads.map((thread) => {
    const msg = thread.getMessages()[0];
    return {
      subject: msg.getSubject(),
      from: msg.getFrom(),
      body: getMessagePlainBody(msg),
    };
  });
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
