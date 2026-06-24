import { deidentifyText } from '../../capabilities/dlp';
import { getMessagePlainBody, getThreadPermalink, searchThreads } from '../../capabilities/gmail';
import { postMessage } from '../../capabilities/slack';
import { getDlpConfig, getGeminiConfig, getGmailDigestConfig } from '../../lib/config';
import { log } from '../../lib/log';
import { maskPii } from '../../lib/mask';
import { type NewsletterInput, type NewsletterSummary, summarizeNewsletterPage } from './gemini';

// 1リクエストで要約に同時投入する件数 兼 1スレッド返信あたりの件数。RPMと要約精度のトレードオフ調整用。同じ値で両方を兼ねる。
const PAGE_SIZE = 5;
const MAX_SUMMARY_NEWSLETTERS = 70;
const BODY_EXCERPT_LEN = 200;
const DIGEST_LABEL = 'newsletter';
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const LOG_MOD = 'gmail-digest';
// 集計ウィンドウの境界時刻（JST）。トリガーが発火しうる最も早い時刻に合わせて固定する。
const WINDOW_BOUNDARY_HOUR = 7;
const DLP_INFO_TYPES = [
  'PERSON_NAME',
  'EMAIL_ADDRESS',
  'PHONE_NUMBER',
  'STREET_ADDRESS',
  'LOCATION',
  'AGE',
  'DATE_OF_BIRTH',
  'GENDER',
  'CREDIT_CARD_NUMBER',
  'IBAN_CODE',
  'SWIFT_CODE',
  'IP_ADDRESS',
  'MAC_ADDRESS',
  'JAPAN_INDIVIDUAL_NUMBER',
  'JAPAN_BANK_ACCOUNT',
  'JAPAN_DRIVERS_LICENSE_NUMBER',
  'JAPAN_PASSPORT',
  'JAPAN_CORPORATE_NUMBER',
];
const DLP_MIN_LIKELIHOOD = 'POSSIBLE';
const MASK_FAILED_BODY = '[本文のマスクに失敗したため除外しました]';

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
 * メール本文をSlack表示用の短い抜粋に整形する。
 * @param body 整形対象の本文
 * @param maxLen 最大文字数
 * @returns ホワイトスペース正規化後、必要に応じて省略記号付きで切り詰めた本文
 */
export function truncateBody(body: string, maxLen = BODY_EXCERPT_LEN): string {
  const normalized = body.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen)}…`;
}

/**
 * 前日のNewsletterメールを検索し、ページ単位のメール要約をSlackへ投稿する。
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

  const count = threads.length;
  if (count === 0) {
    postSlackMessage(cfg, buildParentSlackMessage(dateLabel, count));
    log.info(LOG_MOD, 'done', { count });
    return;
  }

  const useFallback = count > MAX_SUMMARY_NEWSLETTERS;
  const parentTs = postSlackMessage(cfg, buildParentSlackMessage(dateLabel, count, useFallback));

  if (useFallback) {
    for (const threadChunk of chunk(threads, PAGE_SIZE)) {
      postSlackMessage(cfg, {
        text: buildThreadFallbackText(dateLabel, threadChunk),
        blocks: buildThreadFallbackBlocks(threadChunk),
        threadTs: parentTs,
      });
    }
    log.info(LOG_MOD, 'done', { count });
    return;
  }

  const geminiCfg = getGeminiConfig();
  const accessToken = ScriptApp.getOAuthToken();
  const { dlpProjectId } = getDlpConfig();
  for (const threadChunk of chunk(threads, PAGE_SIZE)) {
    let pageSummaries: NewsletterSummary[];
    try {
      pageSummaries = summarizeNewsletterPage(
        buildNewsletterInputs(threadChunk, dlpProjectId, accessToken),
        geminiCfg.geminiModel,
        geminiCfg.geminiApiKey
      );
    } catch (err) {
      log.error(LOG_MOD, 'gemini page summarize failed', err);
      throw err;
    }
    postSlackMessage(cfg, {
      text: buildThreadFallbackText(dateLabel, threadChunk),
      blocks: buildThreadSummaryBlocks(threadChunk, pageSummaries),
      threadTs: parentTs,
    });
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
 * @param fallback 件数超過によりGemini要約を省略する場合はtrue
 * @returns Slack投稿パラメータ
 */
function buildParentSlackMessage(
  dateLabel: string,
  count: number,
  fallback = false
): {
  text: string;
  blocks: unknown[];
} {
  const header = `${count === 0 ? '📭' : '📬'} ${dateLabel}`;
  if (count === 0) {
    return {
      text: `${header}\n新着メールはありませんでした`,
      blocks: [
        {
          type: 'header',
          level: 1,
          text: { type: 'plain_text', text: header },
        },
        {
          type: 'rich_text',
          elements: [
            {
              type: 'rich_text_section',
              elements: [
                {
                  type: 'text',
                  text: '新着メールはありませんでした',
                  style: { italic: true },
                },
              ],
            },
          ],
        },
      ],
    };
  }

  const richTextElements: unknown[] = [
    {
      type: 'rich_text_section',
      elements: [
        { type: 'text', text: `${count}`, style: { bold: true } },
        { type: 'text', text: ' 件のメールが届いています' },
      ],
    },
  ];

  if (fallback) {
    richTextElements.push({
      type: 'rich_text_section',
      elements: [
        { type: 'emoji', name: 'warning' },
        { type: 'text', text: ' 件数が多いため要約は省略し、本文冒頭のみ表示します' },
      ],
    });
  }

  const blocks: unknown[] = [
    {
      type: 'header',
      level: 1,
      text: { type: 'plain_text', text: header },
    },
    { type: 'rich_text', elements: richTextElements },
  ];

  return {
    text: `${header}\n${count}件のメールが届いています`,
    blocks,
  };
}

/**
 * Gemini要約版スレッド返信のBlock Kit blocksを組み立てる。
 * @param threads ダイジェスト対象のGmailスレッド配列
 * @param summaries ページ内メールに対応するGemini要約配列
 * @returns Slack Block Kit blocks
 */
function buildThreadSummaryBlocks(
  threads: GoogleAppsScript.Gmail.GmailThread[],
  summaries: NewsletterSummary[]
): unknown[] {
  return threads.flatMap((thread, index) => {
    const msg = thread.getMessages()[0];
    const from = parseFrom(msg.getFrom());
    const subject = escapeMrkdwn(msg.getSubject());
    const sender = buildSenderText(from);
    const summary = escapeMrkdwn(summaries[index]?.summary ?? '');

    return [
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: sender }],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${subject}*\n${summary}` },
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
 * 本文抜粋版スレッド返信のBlock Kit blocksを組み立てる。
 * @param threads ダイジェスト対象のGmailスレッド配列
 * @returns Slack Block Kit blocks
 */
function buildThreadFallbackBlocks(threads: GoogleAppsScript.Gmail.GmailThread[]): unknown[] {
  return threads.flatMap((thread) => {
    const msg = thread.getMessages()[0];
    const from = parseFrom(msg.getFrom());
    const subject = escapeMrkdwn(msg.getSubject());
    const sender = buildSenderText(from);
    const excerpt = escapeMrkdwn(truncateBody(getMessagePlainBody(msg), BODY_EXCERPT_LEN));

    return [
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: sender }],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${subject}*\n${excerpt}` },
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
 * @param dlpProjectId DLP APIを呼び出すGoogle CloudプロジェクトID
 * @param accessToken DLP API呼び出しに使うOAuthアクセストークン
 * @returns Newsletter入力配列
 */
function buildNewsletterInputs(
  threads: GoogleAppsScript.Gmail.GmailThread[],
  dlpProjectId: string,
  accessToken: string
): NewsletterInput[] {
  return threads.map((thread) => {
    const msg = thread.getMessages()[0];
    const regexMasked = maskPii(getMessagePlainBody(msg));
    let body: string;
    try {
      body = deidentifyText({
        accessToken,
        projectId: dlpProjectId,
        text: regexMasked,
        infoTypes: DLP_INFO_TYPES,
        minLikelihood: DLP_MIN_LIKELIHOOD,
      });
    } catch (err) {
      log.warn(LOG_MOD, 'dlp mask failed', err);
      body = MASK_FAILED_BODY;
    }
    return {
      subject: msg.getSubject(),
      from: msg.getFrom(),
      body,
    };
  });
}

function postSlackMessage(
  cfg: ReturnType<typeof getGmailDigestConfig>,
  params: Parameters<typeof postMessage>[2]
): string {
  try {
    return postMessage(cfg.slackBotToken, cfg.slackChannelId, params);
  } catch (err) {
    log.error(LOG_MOD, 'slack post failed', err);
    throw err;
  }
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
