import {
  type NotionConnectAccessToken,
  type NotionDbId,
  queryDatabase,
} from '../../capabilities/notion';
import { postMessage } from '../../capabilities/slack';
import { getGeminiConfig, getNotionConfig, getWeeklySummaryConfig } from '../../lib/config';
import { log } from '../../lib/log';
import { summarizeTrend, type TrendCluster } from './gemini';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// 週次ウィンドウの境界時刻（JST）。日曜のこの時刻にアンカーしたローリング7日を集計する。
const BOUNDARY_HOUR = 14;
const COMPLETED_STATUS = '完了';
const NOTION_PAGE_SIZE = 100;
// トレンドトピックの足切り件数（これ未満は単発ノイズとして除外）と表示上限。
const MIN_TOPIC_COUNT = 2;
const MAX_TOPICS = 8;
const LOG_MOD = 'weekly-notion-summary';

export type SummaryWindow = { onOrAfter: string; before: string; label: string };
export type SummaryRecord = { title: string; category: string; tags: string[] };
export type RankedTopic = { label: string; count: number; memberTags: string[] };

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
  if (count === 0) {
    postSlackMessage(slackCfg, buildEmptyMessage(window));
    log.info(LOG_MOD, 'done', { count, topics: 0 });
    return;
  }

  const geminiCfg = getGeminiConfig();
  let topics: RankedTopic[];
  let summary: string;
  try {
    const trend = summarizeTrend(records, geminiCfg.geminiModel, geminiCfg.geminiApiKey);
    topics = rankTopics(records, trend.topics);
    summary = trend.summary;
  } catch (err) {
    log.error(LOG_MOD, 'gemini summarize failed', err);
    throw err;
  }

  postSlackMessage(slackCfg, buildSummaryMessage(window, count, summary, topics));
  log.info(LOG_MOD, 'done', { count, topics: topics.length });
}

/**
 * 名寄せクラスタごとの記事件数をコードで決定的に集計し、ランキングして返す。
 * 各クラスタの件数は `memberTags` のいずれかを持つ記事数。1記事が複数クラスタに
 * 該当する場合は各クラスタで重複カウントする。件数2以上を降順・最大8件に絞る。
 * @param records 集計対象の完了レコード
 * @param clusters Geminiが返した名寄せクラスタ
 * @returns 件数2以上・降順・最大8件のトレンドトピック
 */
export function rankTopics(records: SummaryRecord[], clusters: TrendCluster[]): RankedTopic[] {
  return clusters
    .map((cluster) => ({
      label: cluster.label,
      memberTags: cluster.memberTags,
      count: records.filter((record) => record.tags.some((tag) => cluster.memberTags.includes(tag)))
        .length,
    }))
    .filter((topic) => topic.count >= MIN_TOPIC_COUNT)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_TOPICS);
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
 * 対象記事が1件以上のときのSlackメッセージ（ヘッダー＋総件数＋総括＋🔥トレンドトピック）を組み立てる。
 * @param window 集計対象の週次ウィンドウ
 * @param count 完了レコードの総件数
 * @param summary Geminiが返した今週の総括
 * @param topics 件数集計済みのトレンドトピック（空配列のときは突出なしと表示する）
 * @returns Slack投稿パラメータ
 */
export function buildSummaryMessage(
  window: SummaryWindow,
  count: number,
  summary: string,
  topics: RankedTopic[]
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
      { type: 'section', text: { type: 'mrkdwn', text: escapeMrkdwn(summary) } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: '*🔥 今週のトレンドトピック*' } },
      buildTopicsBlock(topics),
    ],
  };
}

/**
 * トレンドトピック一覧のSlack sectionブロックを組み立てる。
 * @param topics 件数集計済みのトレンドトピック
 * @returns 突出トピックがあれば一覧、無ければ専用メッセージのsectionブロック
 */
function buildTopicsBlock(topics: RankedTopic[]): unknown {
  if (topics.length === 0) {
    return {
      type: 'section',
      text: { type: 'mrkdwn', text: '今週は突出したトピックはありませんでした' },
    };
  }

  const lines = topics
    .map(
      (topic) =>
        `• *${escapeMrkdwn(topic.label)}* (${topic.count}件) — ${escapeMrkdwn(topic.memberTags.join(', '))}`
    )
    .join('\n');
  return { type: 'section', text: { type: 'mrkdwn', text: lines } };
}

/**
 * Slackへメッセージを投稿し、失敗時はログを残して再throwする。
 * @param cfg Slack投稿先設定
 * @param message 投稿する本文とBlock Kit
 * @returns なし
 */
function postSlackMessage(
  cfg: ReturnType<typeof getWeeklySummaryConfig>,
  message: { text: string; blocks: unknown[] }
): void {
  try {
    postMessage(cfg.slackBotToken, cfg.slackChannelId, message);
  } catch (err) {
    log.error(LOG_MOD, 'slack post failed', err);
    throw err;
  }
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
