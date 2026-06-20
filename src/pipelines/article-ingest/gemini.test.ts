import { describe, expect, it, vi } from 'vitest';

vi.mock('../../capabilities/gemini');

import { callGeminiAPI } from '../../capabilities/gemini';
import { CATEGORIES, type GeminiResult, parseGeminiResult, summarizeArticle } from './gemini';

const validResult: GeminiResult = {
  title: 'テスト記事',
  overview: 'TypeScriptとVitestを使ったテスト手法の紹介記事',
  summary: [
    { heading: '背景', body: '背景の詳細' },
    { heading: '内容', body: '内容の詳細' },
  ],
  category: 'AI/ML',
  tags: ['TypeScript', 'Vitest'],
};

describe('summarizeArticle', () => {
  it('Geminiの応答テキストをパースして返す', () => {
    vi.mocked(callGeminiAPI).mockReturnValue(JSON.stringify(validResult));

    const result = summarizeArticle('記事本文', 'gemini-2.5-flash', 'api-key');

    expect(result).toEqual(validResult);
  });

  it('記事要約用のsystemInstructionと本文をGeminiに渡す', () => {
    vi.mocked(callGeminiAPI).mockReturnValue(JSON.stringify(validResult));

    summarizeArticle('テスト記事の本文', 'gemini-2.5-flash', 'api-key');

    expect(callGeminiAPI).toHaveBeenCalledWith(
      expect.objectContaining({
        geminiModel: 'gemini-2.5-flash',
        geminiApiKey: 'api-key',
        systemInstruction: expect.stringContaining('分割'),
        userContent: expect.stringContaining('テスト記事の本文'),
      })
    );
  });

  it('記事要約用のresponseSchemaをGeminiに渡す', () => {
    vi.mocked(callGeminiAPI).mockReturnValue(JSON.stringify(validResult));

    summarizeArticle('記事本文', 'gemini-2.5-flash', 'api-key');

    const params = vi.mocked(callGeminiAPI).mock.calls[0][0];
    expect(params.responseSchema?.type).toBe('OBJECT');
    expect(
      (
        params.responseSchema?.properties as {
          category: { enum: string[] };
        }
      ).category.enum
    ).toEqual([...CATEGORIES]);
  });

  it('Geminiの応答テキストがJSONではない場合はエラーを投げる', () => {
    vi.mocked(callGeminiAPI).mockReturnValue('invalid response');

    expect(() => summarizeArticle('記事本文', 'gemini-2.5-flash', 'api-key')).toThrow(
      'Gemini returned invalid JSON'
    );
  });
});

describe('parseGeminiResult', () => {
  it('必須フィールドが欠けている場合はエラーを投げる', () => {
    expect(() => parseGeminiResult(JSON.stringify({ ...validResult, title: undefined }))).toThrow(
      'Gemini returned invalid JSON'
    );
  });

  it('summaryの要素がheadingとbodyを持たない場合はエラーを投げる', () => {
    expect(() =>
      parseGeminiResult(JSON.stringify({ ...validResult, summary: [{ heading: '背景' }] }))
    ).toThrow('Gemini returned invalid JSON');
  });

  it('categoryが定義済みカテゴリではない場合はエラーを投げる', () => {
    expect(() =>
      parseGeminiResult(JSON.stringify({ ...validResult, category: '未定義カテゴリ' }))
    ).toThrow('Gemini returned invalid JSON');
  });
});
