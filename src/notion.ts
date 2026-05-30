import type { GeminiResult } from './gemini';

export type NotionDbId = string;
export type NotionConnectAccessToken = string;

export function writeToNotion(
  data: GeminiResult,
  url: string,
  notionDbId: NotionDbId,
  notionAccessToken: NotionConnectAccessToken
): void {
  const endpoint = 'https://api.notion.com/v1/pages';

  const payload = {
    parent: { database_id: notionDbId },
    properties: {
      タイトル: { title: [{ text: { content: data.title } }] },
      既読: { checkbox: false },
      URL: { url },
      カテゴリー: { select: { name: data.category } },
      タグ: { multi_select: data.tags.map((tag) => ({ name: tag })) },
      ステータス: { select: { name: '完了' } },
      Confidence: { select: { name: data.confidence } },
    },
    children: [
      {
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: 'TL;DR' } }] },
      },
      ...data.tldr.map((item) => ({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ type: 'text', text: { content: item } }] },
      })),
      {
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: '要約' } }] },
      },
      ...data.summary.flatMap((section) => [
        {
          object: 'block',
          type: 'heading_3',
          heading_3: { rich_text: [{ type: 'text', text: { content: section.heading } }] },
        },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: section.body } }] },
        },
      ]),
    ],
  };

  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: `Bearer ${notionAccessToken}`,
      'Notion-Version': '2022-06-28',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(`Notion API error: ${response.getContentText()}`);
  }
}
