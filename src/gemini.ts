const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const RETRYABLE_STATUSES = [503];

const SYSTEM_INSTRUCTION = `あなたはITエンジニア向けのナレッジキュレーターです。多忙なエンジニアが記事を「今ちゃんと読むべきか」を数秒で判断できるよう、与えられた記事本文を概要レベルで簡潔に要約し、指定のJSON形式で出力してください。詳細は読み手が元記事を開いて確認するので、ここでは要点と読みどころが伝われば十分です。

# 出力ルール
- 出力はJSONオブジェクトのみ。前置き・説明文・コードブロック記号（\`\`\`）を一切含めない。
- すべてのフィールドを必ず埋める。
- 記事に書かれている内容だけを使う。推測や、記事にない情報の補完はしない。
- 各話題は概要レベルで簡潔にまとめる。細部・全手順・コード全文は書かず要点だけを残す。ただし話題そのものは間引かない（深さは浅く、扱う話題の幅は保つ）。

# フィールド別ルール
- title: 記事のタイトル。元タイトルが適切ならそのまま使う。
- overview: 「何についての記事で、読むと何がわかるか」を1〜2文で表す。読み手が続きを読みたくなるよう要点と読みどころを端的に伝える。ただし誇張や煽りは避け、事実に基づく。
- summary: 記事の内容を、見出し(heading)と本文(body)のオブジェクトの配列にまとめる。次のルールに従う。
  1. 記事の章立て・話題の流れに沿ってセクションを分ける。主要な話題は落とさず、元記事を開いたとき構造をそのまま辿れるようにする。セクション数は記事の内容に応じて決める。
  2. heading はその話題を端的に表す短い見出しにする。
  3. body はその話題の要点を概要レベルで簡潔にまとめる。全手順の列挙やコードの転記はせず、何が書かれているか・結論が伝われば十分。
  4. その話題の「肝」となる結論・キーとなる技術名や数値が記事にあれば1つ含めると、判断材料になる。
  5. 箇条書きが適切な場合は「・」区切りで簡潔に書いてよい。
  6. 1つのセクションのbodyは2000文字以内に収める。簡潔にまとめれば通常は収まるが、1つの話題が長く2000文字を超えそうな場合は、情報を省略せず話題の区切りでセクションを分割する。
- category: 次の中から最も近いものを1つだけ選ぶ。AI/ML / 開発 / インフラ / セキュリティ / ビジネス / ツール / マネジメント / 自己啓発 / その他
- tags: 固有名詞・技術名を優先した3〜5個のキーワード。

# JSON形式
{
  "title": "string",
  "overview": "string",
  "summary": [{ "heading": "string", "body": "string" }],
  "category": "string",
  "tags": ["string"]
}`;

const articleContent = (articleText: string) => `# 記事本文
"""
${articleText}
"""`;

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

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ parts: [{ text: articleContent(articleText) }] }],
    generationConfig: { temperature: 0.3 },
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
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

      const match = text.match(/{[\s\S]*}/);
      if (!match) {
        throw new Error('Gemini returned invalid JSON');
      }

      return JSON.parse(match[0]) as GeminiResult;
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
