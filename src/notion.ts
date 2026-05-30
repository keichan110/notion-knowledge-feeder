import type { GeminiResult } from './gemini';

export type NotionDbId = string;
export type NotionApiKey = string;

export function writeToNotion(
  data: GeminiResult,
  url: string,
  notionDbId: NotionDbId,
  notionApiKey: NotionApiKey
): void {
  const endpoint = 'https://api.notion.com/v1/pages';

  const payload = {
    parent: { database_id: notionDbId },
    properties: {
      タイトル: { title: [{ text: { content: data.title } }] },
      URL: { url },
      'TL;DR': { rich_text: [{ text: { content: data.tldr } }] },
      要約: { rich_text: [{ text: { content: data.summary } }] },
      カテゴリー: { select: { name: data.category } },
      タグ: { multi_select: data.tags.map((tag) => ({ name: tag })) },
      ステータス: { select: { name: '完了' } },
      Confidence: { select: { name: data.confidence } },
    },
  };

  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: `Bearer ${notionApiKey}`,
      'Notion-Version': '2022-06-28',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(`Notion API error: ${response.getContentText()}`);
  }
}
