const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const RETRYABLE_STATUSES = [503];

export type DlpAccessToken = string;
export type DlpProjectId = string;

export type DeidentifyTextParams = {
  accessToken: DlpAccessToken;
  projectId: DlpProjectId;
  text: string;
  infoTypes: string[];
  minLikelihood?: string;
  location?: string;
};

/**
 * DLP content:deidentifyでテキスト中の機微情報をinfoType名へ置換する。
 * 503エラーは指数バックオフで最大3回リトライする。429を含むその他の非200は即座にエラーを投げる。
 * @param params DLP API呼び出しパラメータ
 * @returns deidentify後のテキスト
 * @throws DLP APIが有効なレスポンスを返さない場合、またはリトライ上限を超えた場合
 */
export function deidentifyText(params: DeidentifyTextParams): string {
  const {
    accessToken,
    projectId,
    text,
    infoTypes,
    minLikelihood = 'POSSIBLE',
    location = 'global',
  } = params;
  if (text === '') return '';

  const endpoint = `https://dlp.googleapis.com/v2/projects/${projectId}/locations/${location}/content:deidentify`;
  const payload = {
    item: { value: text },
    inspectConfig: {
      infoTypes: infoTypes.map((name) => ({ name })),
      minLikelihood,
    },
    deidentifyConfig: {
      infoTypeTransformations: {
        transformations: [
          {
            primitiveTransformation: {
              replaceWithInfoTypeConfig: {},
            },
          },
        ],
      },
    },
  };

  const options = {
    method: 'post' as const,
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  let backoffMs = INITIAL_BACKOFF_MS;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = UrlFetchApp.fetch(endpoint, options);
    const status = response.getResponseCode();

    if (status === 200) {
      const result = JSON.parse(response.getContentText()) as { item?: { value?: string } };
      const value = result.item?.value;
      if (value === undefined) {
        throw new Error('DLP returned invalid response');
      }
      return value;
    }

    if (RETRYABLE_STATUSES.includes(status) && attempt < MAX_RETRIES) {
      Utilities.sleep(backoffMs);
      backoffMs *= 2;
      continue;
    }

    throw new Error(`DLP API error: HTTP ${status}`);
  }

  throw new Error('DLP API error: max retries exceeded');
}
