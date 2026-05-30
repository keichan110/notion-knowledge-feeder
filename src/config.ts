import type { GeminiApiKey, GeminiModel } from './gemini';
import type { NotionApiKey, NotionDbId } from './notion';

export type Config = {
  secretToken: string;
  geminiApiKey: GeminiApiKey;
  geminiModel: GeminiModel;
  notionApiKey: NotionApiKey;
  notionDbId: NotionDbId;
};

export function getConfig(): Config {
  const scriptProperties = PropertiesService.getScriptProperties();
  return {
    secretToken: scriptProperties.getProperty('SECRET_TOKEN') ?? '',
    geminiApiKey: scriptProperties.getProperty('GEMINI_API_KEY') ?? '',
    geminiModel: (scriptProperties.getProperty('GEMINI_MODEL') ??
      'gemini-3.5-flash') as GeminiModel,
    notionApiKey: scriptProperties.getProperty('NOTION_API_KEY') ?? '',
    notionDbId: scriptProperties.getProperty('NOTION_DB_ID') ?? '',
  };
}
