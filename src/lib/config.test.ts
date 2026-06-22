import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getConfig,
  getDlpConfig,
  getGeminiConfig,
  getGmailDigestConfig,
  getNotionConfig,
  getSecretConfig,
  resetConfigCache,
} from './config';

describe('getConfig', () => {
  beforeEach(() => {
    resetConfigCache();
    vi.mocked(PropertiesService.getScriptProperties().getProperties).mockReset();
  });

  it('スクリプトプロパティを一括取得して返す', () => {
    vi.mocked(PropertiesService.getScriptProperties().getProperties).mockReturnValue({
      SECRET_TOKEN: 'token123',
      GEMINI_API_KEY: 'gemini-key',
      GEMINI_MODEL: 'gemini-2.0-flash',
      NOTION_ACCESS_TOKEN: 'notion-key',
      NOTION_DB_ID: 'db-id',
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_CHANNEL_ID: 'C123456',
      DLP_PROJECT_ID: 'dlp-project',
    });

    const config = getConfig();

    expect(config).toEqual({
      secretToken: 'token123',
      geminiApiKey: 'gemini-key',
      geminiModel: 'gemini-2.0-flash',
      notionAccessToken: 'notion-key',
      notionDbId: 'db-id',
      slackBotToken: 'xoxb-test',
      slackChannelId: 'C123456',
      dlpProjectId: 'dlp-project',
    });
    expect(PropertiesService.getScriptProperties().getProperties).toHaveBeenCalledTimes(1);
  });

  it('複数回呼び出しても PropertiesService.getProperties は1回しか呼ばない', () => {
    vi.mocked(PropertiesService.getScriptProperties().getProperties).mockReturnValue({
      SECRET_TOKEN: 'token123',
      GEMINI_API_KEY: 'gemini-key',
      GEMINI_MODEL: 'gemini-2.0-flash',
      NOTION_ACCESS_TOKEN: 'notion-key',
      NOTION_DB_ID: 'db-id',
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_CHANNEL_ID: 'C123456',
      DLP_PROJECT_ID: 'dlp-project',
    });

    getConfig();
    getConfig();
    getSecretConfig();
    getGeminiConfig();
    getNotionConfig();
    getGmailDigestConfig();
    getDlpConfig();

    expect(PropertiesService.getScriptProperties().getProperties).toHaveBeenCalledTimes(1);
  });

  it('プロパティがない場合はデフォルト値を使う', () => {
    vi.mocked(PropertiesService.getScriptProperties().getProperties).mockReturnValue({});

    const config = getConfig();

    expect(config).toEqual({
      secretToken: '',
      geminiApiKey: '',
      geminiModel: 'gemini-3.1-flash-lite',
      notionAccessToken: '',
      notionDbId: '',
      slackBotToken: '',
      slackChannelId: '',
      dlpProjectId: '',
    });
  });

  it('スコープ別ゲッターはキャッシュ済みスナップショットのスライスを返す', () => {
    vi.mocked(PropertiesService.getScriptProperties().getProperties).mockReturnValue({
      SECRET_TOKEN: 'token123',
      GEMINI_API_KEY: 'gemini-key',
      GEMINI_MODEL: 'gemini-2.0-flash',
      NOTION_ACCESS_TOKEN: 'notion-key',
      NOTION_DB_ID: 'db-id',
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_CHANNEL_ID: 'C123456',
      DLP_PROJECT_ID: 'dlp-project',
    });

    expect(getSecretConfig()).toEqual({
      secretToken: 'token123',
    });
    expect(getGeminiConfig()).toEqual({
      geminiApiKey: 'gemini-key',
      geminiModel: 'gemini-2.0-flash',
    });
    expect(getNotionConfig()).toEqual({
      notionAccessToken: 'notion-key',
      notionDbId: 'db-id',
    });
    expect(getGmailDigestConfig()).toEqual({
      slackBotToken: 'xoxb-test',
      slackChannelId: 'C123456',
    });
    expect(getDlpConfig()).toEqual({
      dlpProjectId: 'dlp-project',
    });
    expect(PropertiesService.getScriptProperties().getProperties).toHaveBeenCalledTimes(1);
  });
});
