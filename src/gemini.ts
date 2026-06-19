const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const RETRYABLE_STATUSES = [503];

// Gemini 3 系の thinking レベル。要約精度を優先し medium を指定する（コストはリクエスト数依存のため影響しない）。
const THINKING_LEVEL = 'medium';

const CATEGORIES = [
  'AI/ML',
  '開発',
  'インフラ',
  'セキュリティ',
  'ビジネス',
  'ツール',
  'マネジメント',
  '自己啓発',
  'その他',
] as const;

const SYSTEM_INSTRUCTION = `あなたはITエンジニア向けのナレッジキュレーターです。多忙なエンジニアが記事を「今ちゃんと読むべきか」を数秒で判断できるよう、与えられた記事本文を概要レベルで簡潔に要約し、指定のJSON形式で出力してください。詳細は読み手が元記事を開いて確認するので、ここでは要点と読みどころが伝われば十分です。

# 出力ルール
- すべてのフィールドを必ず埋める。
- 記事に書かれている内容だけを使う。推測・憶測や、記事にない情報の補完はしない。不確かな点は書かない。
- 各話題は概要レベルで簡潔にまとめる。細部・全手順・コード全文は書かず要点だけを残す。ただし話題そのものは間引かない（深さは浅く、扱う話題の幅は保つ）。
- 「要点」には、その話題を特定できる固有名詞（手法名・製品名・技術名）と、記事が示す具体的な数値・指標を含める。これらは概要でも省略せず残す（読み手が深掘りする際の入口になる）。一般的な言い換えで固有名を消さない。

# フィールド別ルール
- title: 記事のタイトル。元タイトルが適切ならそのまま使う。
- overview: 「何についての記事で、読むと何がわかるか」を1〜2文で表す。読み手が続きを読みたくなるよう要点と読みどころを端的に伝える。記事の主題を特定する固有名詞（手法名・製品名・技術名）があれば盛り込む。ただし誇張や煽りは避け、事実に基づく。
- summary: 記事の内容を、見出し(heading)と本文(body)のオブジェクトの配列にまとめる。次のルールに従う。
  1. 記事の章立て・話題の流れに沿ってセクションを分ける。主要な話題は落とさず、元記事を開いたとき構造をそのまま辿れるようにする。セクション数は記事の内容に応じて決める。
  2. heading はその話題を端的に表す短い見出しにする。
  3. body はその話題の要点を概要レベルで簡潔にまとめる。全手順の列挙やコードの転記はせず、何が書かれているか・結論が伝われば十分。
  4. その話題の「肝」となる結論・キーとなる技術名・固有名詞・数値・指標が記事にあれば省略せず含める。これらは判断材料かつ深掘りの入口になるため、一般的な説明に丸めて消さない。複数あれば代表的なものを残す。
  5. 箇条書きが適切な場合は「・」区切りで簡潔に書いてよい。
  6. 1つのセクションのbodyは2000文字以内に収める。簡潔にまとめれば通常は収まるが、1つの話題が長く2000文字を超えそうな場合は、情報を省略せず話題の区切りでセクションを分割する。
- category: 次の中から最も近いものを1つだけ選ぶ。${CATEGORIES.join(' / ')}
- tags: 固有名詞・技術名を優先した3〜5個のキーワード。`;

const articleContent = (articleText: string) => `# 記事本文
"""
${articleText}
"""`;

// Gemini の構造化出力（responseSchema）。GeminiResult の形状を API レベルで保証する。
// type は REST API 仕様に従い大文字表記を使う。
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    overview: { type: 'STRING' },
    summary: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          heading: { type: 'STRING' },
          body: { type: 'STRING' },
        },
        required: ['heading', 'body'],
        propertyOrdering: ['heading', 'body'],
      },
    },
    category: { type: 'STRING', enum: [...CATEGORIES] },
    tags: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
  },
  required: ['title', 'overview', 'summary', 'category', 'tags'],
  propertyOrdering: ['title', 'overview', 'summary', 'category', 'tags'],
};

export type GeminiModel =
  | 'gemini-3.5-flash'
  | 'gemini-3.1-pro-preview'
  | 'gemini-3.1-flash-lite'
  | 'gemini-2.5-flash'
  | 'gemini-2.5-flash-lite'
  | 'gemini-2.5-pro';
export type GeminiApiKey = string;

export type SummarySection = {
  heading: string;
  body: string;
};

export type GeminiResult = {
  title: string;
  overview: string;
  summary: SummarySection[];
  category: string;
  tags: string[];
};

/**
 * Gemini APIに記事本文を送信し、要約・構造化した結果を返す。
 * 503エラーは指数バックオフで最大3回リトライする。429エラーはリトライせず即座にエラーを投げる。
 * @param articleText 要約対象の記事本文
 * @param geminiModel 使用するGeminiモデル名
 * @param geminiApiKey Gemini APIキー
 * @returns 要約・構造化された `GeminiResult`
 * @throws Gemini APIが有効なJSONを返さない場合、またはリトライ上限を超えた場合
 */
export function callGeminiAPI(
  articleText: string,
  geminiModel: GeminiModel,
  geminiApiKey: GeminiApiKey
): GeminiResult {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;

  const generationConfig: Record<string, unknown> = {
    // Gemini 3 系は temperature 1.0（デフォルト）が推奨。下げるとループや性能劣化を招きうる。
    // 忠実性・憶測抑制は temperature ではなく systemInstruction・responseSchema・thinkingLevel で担保する。
    temperature: 1.0,
    responseMimeType: 'application/json',
    responseSchema: RESPONSE_SCHEMA,
  };
  // thinkingLevel は Gemini 3 系専用。2.5 系は thinkingBudget 方式で非対応のため設定しない。
  if (geminiModel.startsWith('gemini-3')) {
    generationConfig.thinkingConfig = { thinkingLevel: THINKING_LEVEL };
  }

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ parts: [{ text: articleContent(articleText) }] }],
    generationConfig,
  };

  const options = {
    method: 'post' as const,
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  let backoffMs = INITIAL_BACKOFF_MS;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = UrlFetchApp.fetch(endpoint, options);
    const status = response.getResponseCode();

    if (status === 200) {
      const result = JSON.parse(response.getContentText()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Gemini returned invalid JSON');
      }

      // responseSchema により JSON のみが返るため、そのままパースする。
      try {
        return JSON.parse(text) as GeminiResult;
      } catch {
        throw new Error('Gemini returned invalid JSON');
      }
    }

    if (RETRYABLE_STATUSES.includes(status) && attempt < MAX_RETRIES) {
      Utilities.sleep(backoffMs);
      backoffMs *= 2;
      continue;
    }

    throw new Error(`Gemini API error: HTTP ${status}`);
  }

  throw new Error('Gemini API error: max retries exceeded');
}
