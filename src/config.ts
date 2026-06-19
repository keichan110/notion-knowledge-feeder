import type { GeminiApiKey, GeminiModel } from './gemini';
import type { NotionConnectAccessToken, NotionDbId } from './notion';

export type Config = {
  secretToken: string;
  geminiApiKey: GeminiApiKey;
  geminiModel: GeminiModel;
  notionAccessToken: NotionConnectAccessToken;
  notionDbId: NotionDbId;
};

let _configCache: Config | null = null;

/**
 * GASスクリプトプロパティから設定値を読み込んで返す。1実行内でキャッシュされる。
 * @returns アプリケーション設定オブジェクト
 */
export function getConfig(): Config {
  if (_configCache) return _configCache;
  const scriptProperties = PropertiesService.getScriptProperties();
  _configCache = {
    secretToken: scriptProperties.getProperty('SECRET_TOKEN') ?? '',
    geminiApiKey: scriptProperties.getProperty('GEMINI_API_KEY') ?? '',
    geminiModel: (scriptProperties.getProperty('GEMINI_MODEL') ??
      'gemini-3.1-flash-lite') as GeminiModel,
    notionAccessToken: scriptProperties.getProperty('NOTION_ACCESS_TOKEN') ?? '',
    notionDbId: scriptProperties.getProperty('NOTION_DB_ID') ?? '',
  };
  return _configCache;
}

/**
 * 設定キャッシュをクリアする。テスト用。
 */
export function resetConfigCache(): void {
  _configCache = null;
}

/**
 * 未処理記事フラグ（`HAS_PENDING`）が立っているか確認する。
 * @returns フラグが `"true"` のとき `true`、それ以外は `false`
 */
export function hasPending(): boolean {
  return PropertiesService.getScriptProperties().getProperty('HAS_PENDING') === 'true';
}

/**
 * 未処理記事フラグ（`HAS_PENDING`）を `"true"` にセットする。
 */
export function setHasPending(): void {
  PropertiesService.getScriptProperties().setProperty('HAS_PENDING', 'true');
}

/**
 * 未処理記事フラグ（`HAS_PENDING`）を削除する。
 */
export function clearHasPending(): void {
  PropertiesService.getScriptProperties().setProperty('HAS_PENDING', 'false');
}
