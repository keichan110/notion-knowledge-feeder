import { always, dailyAt, everyHours, type Job, weeklyAt } from './lib/scheduler';
import {
  processPendingArticles,
  processTrendingQiita,
  processTrendingZenn,
} from './pipelines/article-ingest';
import { runGmailDigest } from './pipelines/gmail-digest';
import { runLabelCleanup as runGmailLabelCleanup } from './pipelines/gmail-label-cleanup';
import { runWeeklyNotionSummary } from './pipelines/weekly-notion-summary';

/**
 * 10分トリガーで分岐する宣言的スケジュールテーブル。
 * サブ時間カデンスは必要時に専用種別を追加する。
 */
export const TEN_MINUTE_SCHEDULE: readonly Job[] = [
  {
    name: 'article-ingest:pending',
    weight: 'light',
    at: always(),
    run: () => processPendingArticles(),
  },
];

/**
 * 毎時トリガーで分岐する宣言的スケジュールテーブル。
 */
export const HOURLY_SCHEDULE: readonly Job[] = [
  {
    name: 'gmail-digest:overnight',
    weight: 'heavy',
    at: dailyAt(7),
    run: () => runGmailDigest(),
  },
  {
    name: 'trends:qiita',
    weight: 'light',
    at: dailyAt(10),
    run: () => processTrendingQiita(),
  },
  {
    name: 'trends:zenn',
    weight: 'light',
    at: dailyAt(10),
    run: () => processTrendingZenn(),
  },
  {
    name: 'gmail-label-cleanup',
    weight: 'light',
    at: everyHours(3),
    run: () => runGmailLabelCleanup(),
  },
  {
    name: 'weekly-notion-summary',
    weight: 'heavy',
    at: weeklyAt(0, 14),
    run: () => runWeeklyNotionSummary(),
  },
];
