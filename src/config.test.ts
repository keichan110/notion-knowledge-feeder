import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfig } from './config';

describe('getConfig', () => {
  beforeEach(() => {
    vi.mocked(PropertiesService.getScriptProperties().getProperty).mockReset();
  });

  it('各プロパティを取得して返す', () => {
    vi.mocked(PropertiesService.getScriptProperties().getProperty).mockImplementation((key) => {
      const props: Record<string, string> = {
        SECRET_TOKEN: 'token123',
        GEMINI_API_KEY: 'gemini-key',
        GEMINI_MODEL: 'gemini-2.0-flash',
        NOTION_ACCESS_TOKEN: 'notion-key',
        NOTION_DB_ID: 'db-id',
      };
      return props[key] ?? null;
    });

    const config = getConfig();

    expect(config).toEqual({
      secretToken: 'token123',
      geminiApiKey: 'gemini-key',
      geminiModel: 'gemini-2.0-flash',
      notionAccessToken: 'notion-key',
      notionDbId: 'db-id',
    });
  });

  it('プロパティがnullの場合はデフォルト値を使う', () => {
    vi.mocked(PropertiesService.getScriptProperties().getProperty).mockReturnValue(null);

    const config = getConfig();

    expect(config).toEqual({
      secretToken: '',
      geminiApiKey: '',
      geminiModel: 'gemini-3.5-flash',
      notionAccessToken: '',
      notionDbId: '',
    });
  });
});
