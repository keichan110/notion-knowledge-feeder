import { describe, expect, it } from 'vitest';
import { parseTrendSummary } from './gemini';

const INVALID = 'Gemini returned invalid trend summary JSON';

describe('parseTrendSummary', () => {
  it('正常なJSONをTrendSummaryとして返す', () => {
    const text = JSON.stringify({
      summary: '今週の総括',
      topics: [{ label: 'RAG / 検索拡張生成', memberTags: ['RAG', '検索拡張生成', 'retrieval'] }],
    });

    expect(parseTrendSummary(text)).toEqual({
      summary: '今週の総括',
      topics: [{ label: 'RAG / 検索拡張生成', memberTags: ['RAG', '検索拡張生成', 'retrieval'] }],
    });
  });

  it('topicsが空配列でも正常に扱う', () => {
    expect(parseTrendSummary(JSON.stringify({ summary: '総括', topics: [] }))).toEqual({
      summary: '総括',
      topics: [],
    });
  });

  it('topics欠落は明示エラーを投げる', () => {
    expect(() => parseTrendSummary(JSON.stringify({ summary: '総括' }))).toThrow(INVALID);
  });

  it('memberTagsが非配列なら明示エラーを投げる', () => {
    const text = JSON.stringify({ summary: '総括', topics: [{ label: 'RAG', memberTags: 'RAG' }] });

    expect(() => parseTrendSummary(text)).toThrow(INVALID);
  });

  it('空文字列など不正JSONは明示エラーを投げる', () => {
    expect(() => parseTrendSummary('')).toThrow(INVALID);
  });
});
