import {
  callGeminiAPI,
  type GeminiApiKey,
  type GeminiModel,
  type GeminiResponseSchema,
} from '../../capabilities/gemini';
import type { SummaryRecord } from '.';

const SYSTEM_INSTRUCTION = `あなたはITエンジニア向けのトレンドアナリストです。ある1週間に読まれた記事一覧（タイトル・カテゴリー・タグ）を渡すので、その週のトレンドを名寄せして俯瞰できるよう、指定のJSON形式で出力してください。

# タスク
1. topics: タグの表記揺れ（例: \`Claude\` / \`claude\` / \`Claude Code\`、\`RAG\` / \`検索拡張生成\` / \`retrieval\`）を、意味で同じものをまとめた「名寄せクラスタ」にする。各クラスタは代表ラベル（label）と、そこに属する生タグ群（memberTags）で表す。
2. summary: その週全体のトレンドを1段落で総括する。

# ルール
- memberTags には、入力に実際に出現したタグだけを入れる。入力に無いタグを創作しない。
- 件数は数えない。各トピックが何件かはこちらで集計するので、件数や順位には言及しない。
- label は人が読んで分かる簡潔な代表名にする。表記揺れを束ねた意味が伝わるようにする。
- カテゴリーはクラスタリングの文脈として使ってよいが、出力には含めない。
- 記事に書かれている情報だけを使い、推測で補完しない。`;

const RESPONSE_SCHEMA: GeminiResponseSchema = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    topics: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          memberTags: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['label', 'memberTags'],
        propertyOrdering: ['label', 'memberTags'],
      },
    },
  },
  required: ['summary', 'topics'],
  propertyOrdering: ['summary', 'topics'],
};

export type TrendCluster = { label: string; memberTags: string[] };
export type TrendSummary = { summary: string; topics: TrendCluster[] };

/**
 * その週の記事一覧をGeminiに渡し、タグの名寄せクラスタと総括を1回で得る。
 * @param records 集計対象の完了レコード（タイトル・カテゴリー・タグ）
 * @param geminiModel 使用するGeminiモデル名
 * @param geminiApiKey Gemini APIキー
 * @returns 名寄せクラスタと総括を含む構造化結果
 * @throws Geminiの応答が `TrendSummary` として有効なJSONではない場合
 */
export function summarizeTrend(
  records: SummaryRecord[],
  geminiModel: GeminiModel,
  geminiApiKey: GeminiApiKey
): TrendSummary {
  const text = callGeminiAPI({
    geminiModel,
    geminiApiKey,
    systemInstruction: SYSTEM_INSTRUCTION,
    userContent: trendContent(records),
    responseSchema: RESPONSE_SCHEMA,
  });

  return parseTrendSummary(text);
}

/**
 * Geminiの応答テキストを `TrendSummary` としてパースし、必須フィールドを検証する。
 * @param text Gemini APIから返された応答テキスト
 * @returns 検証済みの `TrendSummary`
 * @throws 応答テキストがJSONとして不正、または `TrendSummary` の形状を満たさない場合
 */
export function parseTrendSummary(text: string): TrendSummary {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Gemini returned invalid trend summary JSON');
  }
  if (!isTrendSummary(value)) {
    throw new Error('Gemini returned invalid trend summary JSON');
  }
  return value;
}

function trendContent(records: SummaryRecord[]): string {
  return records
    .map(
      (record, index) => `## 記事${index + 1}
タイトル: ${record.title}
カテゴリー: ${record.category}
タグ: ${record.tags.join(', ')}`
    )
    .join('\n\n');
}

function isTrendSummary(value: unknown): value is TrendSummary {
  return (
    isRecord(value) &&
    typeof value.summary === 'string' &&
    Array.isArray(value.topics) &&
    value.topics.every(isTrendCluster)
  );
}

function isTrendCluster(value: unknown): value is TrendCluster {
  return (
    isRecord(value) &&
    typeof value.label === 'string' &&
    Array.isArray(value.memberTags) &&
    value.memberTags.every((tag) => typeof tag === 'string')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
