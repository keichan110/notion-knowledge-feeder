import {
  type NotionConnectAccessToken,
  type NotionDbId,
  queryDatabase,
} from '../../capabilities/notion';
import { postMessage } from '../../capabilities/slack';
import { getNotionConfig, getWeeklySummaryConfig } from '../../lib/config';
import { log } from '../../lib/log';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// 週次ウィンドウの境界時刻（JST）。日曜のこの時刻にアンカーしたローリング7日を集計する。
const BOUNDARY_HOUR = 14;
const COMPLETED_STATUS = '完了';
const NOTION_PAGE_SIZE = 100;
const LOG_MOD = 'weekly-notion-summary';

export type SummaryWindow = { onOrAfter: string; before: string; label: string };
export type SummaryRecord = { title: string; category: string; tags: string[] };

/**
 * 指定時刻を基準に、直近の日曜14:00 JSTにアンカーした週次ウィンドウを返す。
 * @param now 基準時刻
 * @returns Notionの`created_time`フィルタ用ISO境界（先週日14:00〜今週日14:00）と表示用ラベル
 */
export function getSummaryWindow(now: Date): SummaryWindow {
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
  const todayJstMidnightMs =
    Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate()) - JST_OFFSET_MS;
  const weekday = jstNow.getUTCDay();
  const recentSundayBoundaryMs = todayJstMidnightMs - weekday * DAY_MS + BOUNDARY_HOUR * HOUR_MS;
  const beforeMs =
    now.getTime() >= recentSundayBoundaryMs
      ? recentSundayBoundaryMs
      : recentSundayBoundaryMs - 7 * DAY_MS;
  const onOrAfterMs = beforeMs - 7 * DAY_MS;

  return {
    onOrAfter: new Date(onOrAfterMs).toISOString(),
    before: new Date(beforeMs).toISOString(),
    label: `${fmtJstDate(onOrAfterMs)} 〜 ${fmtJstDate(beforeMs)}`,
  };
}

/**
 * 週次ウィンドウ内に完了したNotion記事を集約し、件数の概況をSlackへ1メッセージ投稿する。
 * 対象が0件のときは「対象なし」を投稿する。
 * @returns なし
 */
export function runWeeklyNotionSummary(): void {
  const { notionAccessToken, notionDbId } = getNotionConfig();
  const slackCfg = getWeeklySummaryConfig();
  const window = getSummaryWindow(new Date());
  log.info(LOG_MOD, 'start', { onOrAfter: window.onOrAfter, before: window.before });

  let records: SummaryRecord[];
  try {
    records = fetchCompletedRecords(window, notionDbId, notionAccessToken);
  } catch (err) {
    log.error(LOG_MOD, 'notion query failed', err);
    throw err;
  }

  const count = records.length;
  const message = count === 0 ? buildEmptyMessage(window) : buildSummaryMessage(window, count);
  try {
    postMessage(slackCfg.slackBotToken, slackCfg.slackChannelId, message);
  } catch (err) {
    log.error(LOG_MOD, 'slack post failed', err);
    throw err;
  }

  log.info(LOG_MOD, 'done', { count });
}

type NotionPage = {
  properties: {
    // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
    ['タイトル']?: { title?: { plain_text?: string }[] };
    // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
    ['カテゴリー']?: { select?: { name?: string } | null };
    // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
    ['タグ']?: { multi_select?: { name?: string }[] };
  };
};

type NotionQueryResponse = {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
};

/**
 * 週次ウィンドウ内の「完了」レコードをページネーション込みで全件取得する。
 * @param window 集計対象の週次ウィンドウ
 * @param notionDbId 検索対象のNotionデータベースID
 * @param notionAccessToken Notion APIアクセストークン
 * @returns タイトル・カテゴリー・タグを抽出した完了レコード配列
 */
function fetchCompletedRecords(
  window: SummaryWindow,
  notionDbId: NotionDbId,
  notionAccessToken: NotionConnectAccessToken
): SummaryRecord[] {
  const records: SummaryRecord[] = [];
  let cursor: string | undefined;

  do {
    const query: Record<string, unknown> = {
      filter: {
        and: [
          { property: 'ステータス', select: { equals: COMPLETED_STATUS } },
          { timestamp: 'created_time', created_time: { on_or_after: window.onOrAfter } },
          { timestamp: 'created_time', created_time: { before: window.before } },
        ],
      },
      page_size: NOTION_PAGE_SIZE,
    };
    if (cursor) query.start_cursor = cursor;

    const response = queryDatabase<NotionQueryResponse>(notionDbId, query, notionAccessToken);
    for (const page of response.results) records.push(extractRecord(page));
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return records;
}

/**
 * Notionページからタイトル・カテゴリー・タグを抽出する。
 * @param page Notion APIのページオブジェクト
 * @returns 抽出済みの完了レコード
 */
function extractRecord(page: NotionPage): SummaryRecord {
  // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
  const title = (page.properties['タイトル']?.title ?? [])
    .map((part) => part.plain_text ?? '')
    .join('');
  // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
  const category = page.properties['カテゴリー']?.select?.name ?? '';
  // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
  const tags = (page.properties['タグ']?.multi_select ?? [])
    .map((tag) => tag.name ?? '')
    .filter((name) => name !== '');

  return { title, category, tags };
}

/**
 * 対象記事が0件のときのSlackメッセージを組み立てる。
 * @param window 集計対象の週次ウィンドウ
 * @returns Slack投稿パラメータ
 */
function buildEmptyMessage(window: SummaryWindow): { text: string; blocks: unknown[] } {
  const header = `📭 週次サマリー ${window.label}`;
  return {
    text: `${header}\n今週は対象記事がありませんでした`,
    blocks: [
      { type: 'header', level: 1, text: { type: 'plain_text', text: header } },
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              { type: 'text', text: '今週は対象記事がありませんでした', style: { italic: true } },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * 対象記事が1件以上のときのSlackメッセージ（ヘッダー＋総件数）を組み立てる。
 * @param window 集計対象の週次ウィンドウ
 * @param count 完了レコードの総件数
 * @returns Slack投稿パラメータ
 */
function buildSummaryMessage(
  window: SummaryWindow,
  count: number
): { text: string; blocks: unknown[] } {
  const header = `📊 週次サマリー ${window.label}`;
  return {
    text: `${header}\n今週は${count}件の記事がまとまりました`,
    blocks: [
      { type: 'header', level: 1, text: { type: 'plain_text', text: header } },
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              { type: 'text', text: `${count}`, style: { bold: true } },
              { type: 'text', text: ' 件の記事がまとまりました' },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * epochミリ秒をJSTの`yyyy/MM/dd`表記に変換する。
 * @param ms 変換対象のepochミリ秒
 * @returns JST日付文字列
 */
function fmtJstDate(ms: number): string {
  const jst = new Date(ms + JST_OFFSET_MS);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}
