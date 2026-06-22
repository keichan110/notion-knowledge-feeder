import type { DlpProjectId } from '../capabilities/dlp';
import type { GeminiApiKey, GeminiModel } from '../capabilities/gemini';
import type { NotionConnectAccessToken, NotionDbId } from '../capabilities/notion';
import type { SlackBotToken, SlackChannelId } from '../capabilities/slack';

export type Config = {
  secretToken: string;
  geminiApiKey: GeminiApiKey;
  geminiModel: GeminiModel;
  notionAccessToken: NotionConnectAccessToken;
  notionDbId: NotionDbId;
  slackBotToken: SlackBotToken;
  slackChannelId: SlackChannelId;
  dlpProjectId: DlpProjectId;
};

export type SecretConfig = Pick<Config, 'secretToken'>;
export type GeminiConfig = Pick<Config, 'geminiApiKey' | 'geminiModel'>;
export type NotionConfig = Pick<Config, 'notionAccessToken' | 'notionDbId'>;
export type SlackConfig = Pick<Config, 'slackBotToken' | 'slackChannelId'>;
export type GmailDigestConfig = Pick<Config, 'slackBotToken' | 'slackChannelId'>;
export type DlpConfig = Pick<Config, 'dlpProjectId'>;

type ConfigSnapshot = Record<string, string>;

let _configSnapshotCache: ConfigSnapshot | null = null;

/**
 * GASスクリプトプロパティのスナップショットを一括取得し、1実行内で再利用する。
 * @returns キャッシュ済み、または新規取得したスクリプトプロパティ
 */
function getConfigSnapshot(): ConfigSnapshot {
  if (_configSnapshotCache) return _configSnapshotCache;
  _configSnapshotCache = PropertiesService.getScriptProperties().getProperties();
  return _configSnapshotCache;
}

/**
 * スクリプトプロパティのスナップショットをアプリケーション設定へ変換する。
 * @param snapshot スクリプトプロパティの一括取得結果
 * @returns デフォルト値を補完したアプリケーション設定
 */
function buildConfig(snapshot: ConfigSnapshot): Config {
  return {
    secretToken: snapshot.SECRET_TOKEN ?? '',
    geminiApiKey: snapshot.GEMINI_API_KEY ?? '',
    geminiModel: (snapshot.GEMINI_MODEL ?? 'gemini-3.1-flash-lite') as GeminiModel,
    notionAccessToken: snapshot.NOTION_ACCESS_TOKEN ?? '',
    notionDbId: snapshot.NOTION_DB_ID ?? '',
    slackBotToken: (snapshot.SLACK_BOT_TOKEN ?? '') as SlackBotToken,
    slackChannelId: (snapshot.SLACK_CHANNEL_ID ?? '') as SlackChannelId,
    dlpProjectId: snapshot.DLP_PROJECT_ID ?? '',
  };
}

/**
 * GASスクリプトプロパティから全設定値を読み込んで返す。1実行内で一括取得結果がキャッシュされる。
 * @returns アプリケーション設定オブジェクト
 */
export function getConfig(): Config {
  return buildConfig(getConfigSnapshot());
}

/**
 * 認証用Secret設定をキャッシュ済みスクリプトプロパティから取得する。
 * @returns 認証用Secret設定
 */
export function getSecretConfig(): SecretConfig {
  const { secretToken } = buildConfig(getConfigSnapshot());
  return { secretToken };
}

/**
 * Gemini設定をキャッシュ済みスクリプトプロパティから取得する。
 * @returns Gemini APIキーとモデル名
 */
export function getGeminiConfig(): GeminiConfig {
  const { geminiApiKey, geminiModel } = buildConfig(getConfigSnapshot());
  return { geminiApiKey, geminiModel };
}

/**
 * Notion設定をキャッシュ済みスクリプトプロパティから取得する。
 * @returns Notion APIアクセストークンとデータベースID
 */
export function getNotionConfig(): NotionConfig {
  const { notionAccessToken, notionDbId } = buildConfig(getConfigSnapshot());
  return { notionAccessToken, notionDbId };
}

/**
 * Gmailダイジェスト用のSlack投稿先設定をキャッシュ済みスクリプトプロパティから取得する。
 * @returns Slack投稿先設定
 */
export function getGmailDigestConfig(): GmailDigestConfig {
  const { slackBotToken, slackChannelId } = buildConfig(getConfigSnapshot());
  return { slackBotToken, slackChannelId };
}

/**
 * DLP設定をキャッシュ済みスクリプトプロパティから取得する。
 * @returns DLPプロジェクトID
 */
export function getDlpConfig(): DlpConfig {
  const { dlpProjectId } = buildConfig(getConfigSnapshot());
  return { dlpProjectId };
}

/**
 * 設定キャッシュをクリアする。テスト用。
 * @returns なし
 */
export function resetConfigCache(): void {
  _configSnapshotCache = null;
}
