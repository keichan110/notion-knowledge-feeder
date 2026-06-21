import { describe, expect, it, vi } from 'vitest';

vi.mock('../../capabilities/gemini');

import { callGeminiAPI } from '../../capabilities/gemini';
import {
  type DigestSummary,
  type NewsletterInput,
  parseDigestSummary,
  summarizeNewsletters,
} from './gemini';

const newsletters: NewsletterInput[] = [
  { subject: 'Newsletter 1', from: 'sender1@example.com', body: '本文1' },
  { subject: 'Newsletter 2', from: 'sender2@example.com', body: '本文2' },
];

const validSummary: DigestSummary = {
  actionItems: [{ subject: 'Newsletter 1', reason: '6月30日までに回答が必要' }],
  categories: [
    { label: 'AI/ML', count: 1 },
    { label: 'イベント案内', count: 1 },
  ],
  overview: '前日のNewsletterではGeminiとイベント案内が中心でした。',
};

describe('summarizeNewsletters', () => {
  it('digest用のsystemInstructionと全NewsletterをGeminiに渡す', () => {
    vi.mocked(callGeminiAPI).mockReturnValue(JSON.stringify(validSummary));

    summarizeNewsletters(newsletters, 'gemini-3.1-flash-lite', 'api-key');

    expect(callGeminiAPI).toHaveBeenCalledWith(
      expect.objectContaining({
        geminiModel: 'gemini-3.1-flash-lite',
        geminiApiKey: 'api-key',
        systemInstruction: expect.stringContaining('複数のNewsletterを横断的に要約'),
        userContent: expect.stringContaining('Newsletter 1'),
        responseSchema: expect.objectContaining({ type: 'OBJECT' }),
      })
    );
    const params = vi.mocked(callGeminiAPI).mock.calls[0][0];
    expect(params.userContent).toContain('本文1');
    expect(params.userContent).toContain('Newsletter 2');
    expect(params.userContent).toContain('本文2');
  });

  it('digest用のresponseSchemaをGeminiに渡す', () => {
    vi.mocked(callGeminiAPI).mockReturnValue(JSON.stringify(validSummary));

    summarizeNewsletters(newsletters, 'gemini-3.1-flash-lite', 'api-key');

    const params = vi.mocked(callGeminiAPI).mock.calls[0][0];
    expect(params.responseSchema).toEqual(
      expect.objectContaining({
        type: 'OBJECT',
        required: ['actionItems', 'categories', 'overview'],
        propertyOrdering: ['actionItems', 'categories', 'overview'],
      })
    );
  });

  it('Geminiの応答テキストをパースして返す', () => {
    vi.mocked(callGeminiAPI).mockReturnValue(JSON.stringify(validSummary));

    const result = summarizeNewsletters(newsletters, 'gemini-3.1-flash-lite', 'api-key');

    expect(result).toEqual(validSummary);
  });

  it('Geminiの応答テキストがJSONではない場合はエラーを投げる', () => {
    vi.mocked(callGeminiAPI).mockReturnValue('invalid response');

    expect(() => summarizeNewsletters(newsletters, 'gemini-3.1-flash-lite', 'api-key')).toThrow(
      'Gemini returned invalid JSON'
    );
  });
});

describe('parseDigestSummary', () => {
  it('必須フィールドが欠けている場合はエラーを投げる', () => {
    expect(() =>
      parseDigestSummary(JSON.stringify({ ...validSummary, overview: undefined }))
    ).toThrow('Gemini returned invalid JSON');
  });

  it('actionItemsが空配列でも有効な結果として返す', () => {
    const summary = { ...validSummary, actionItems: [] };

    expect(parseDigestSummary(JSON.stringify(summary))).toEqual(summary);
  });

  it('categoriesの要素の型が不正な場合はエラーを投げる', () => {
    expect(() =>
      parseDigestSummary(
        JSON.stringify({ ...validSummary, categories: [{ label: 'AI/ML', count: '1' }] })
      )
    ).toThrow('Gemini returned invalid JSON');
  });
});
