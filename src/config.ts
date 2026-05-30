import type { GeminiApiKey, GeminiModel } from './gemini';
import type { NotionConnectAccessToken, NotionDbId } from './notion';

export type Config = {
  secretToken: string;
  geminiApiKey: GeminiApiKey;
  geminiModel: GeminiModel;
  notionAccessToken: NotionConnectAccessToken;
  notionDbId: NotionDbId;
};

export function getConfig(): Config {
  const scriptProperties = PropertiesService.getScriptProperties();
  return {
    secretToken: scriptProperties.getProperty('SECRET_TOKEN') ?? '',
    geminiApiKey: scriptProperties.getProperty('GEMINI_API_KEY') ?? '',
    geminiModel: (scriptProperties.getProperty('GEMINI_MODEL') ??
      'gemini-3.5-flash') as GeminiModel,
    notionAccessToken: scriptProperties.getProperty('NOTION_ACCESS_TOKEN') ?? '',
    notionDbId: scriptProperties.getProperty('NOTION_DB_ID') ?? '',
  };
}
