import { dailyAt, everyHours, type Job } from './lib/scheduler';
import { processTrendingQiita, processTrendingZenn } from './pipelines/article-ingest';
import { runGmailDigest } from './pipelines/gmail-digest';
import { runLabelCleanup as runGmailLabelCleanup } from './pipelines/gmail-label-cleanup';

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
];
