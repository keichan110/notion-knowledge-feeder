import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearHasPending, getConfig, hasPending, resetConfigCache, setHasPending } from './config';

describe('getConfig', () => {
  beforeEach(() => {
    resetConfigCache();
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

  it('2回呼び出しても PropertiesService.getProperty は1回分しか呼ばない', () => {
    getConfig();
    getConfig();

    expect(PropertiesService.getScriptProperties().getProperty).toHaveBeenCalledTimes(5);
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

describe('hasPending', () => {
  it('HAS_PENDINGが"true"の場合はtrueを返す', () => {
    vi.mocked(PropertiesService.getScriptProperties().getProperty).mockReturnValue('true');

    expect(hasPending()).toBe(true);
  });

  it('HAS_PENDINGが未設定の場合はfalseを返す', () => {
    vi.mocked(PropertiesService.getScriptProperties().getProperty).mockReturnValue(null);

    expect(hasPending()).toBe(false);
  });
});

describe('setHasPending', () => {
  it('HAS_PENDINGに"true"をセットする', () => {
    setHasPending();

    expect(PropertiesService.getScriptProperties().setProperty).toHaveBeenCalledWith(
      'HAS_PENDING',
      'true'
    );
  });
});

describe('clearHasPending', () => {
  it('HAS_PENDINGを削除する', () => {
    clearHasPending();

    expect(PropertiesService.getScriptProperties().deleteProperty).toHaveBeenCalledWith(
      'HAS_PENDING'
    );
  });
});
