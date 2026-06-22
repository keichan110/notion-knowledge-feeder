import { describe, expect, it, vi } from 'vitest';
import { deidentifyText } from './dlp';

const callParams = {
  accessToken: 'access-token',
  projectId: 'project-id',
  text: 'hello user@example.com',
  infoTypes: ['EMAIL_ADDRESS', 'PHONE_NUMBER'],
};

const mockResponse = (code: number, text: string) => ({
  getResponseCode: vi.fn().mockReturnValue(code),
  getContentText: vi.fn().mockReturnValue(text),
});

const dlpResponseText = (value: string) =>
  JSON.stringify({
    item: { value },
  });

describe('deidentifyText', () => {
  it('DLPのレスポンスからitem.valueを取り出して返す', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(
      mockResponse(200, dlpResponseText('hello [EMAIL_ADDRESS]')) as never
    );

    const result = deidentifyText(callParams);

    expect(result).toBe('hello [EMAIL_ADDRESS]');
  });

  it('正しいエンドポイントとペイロードでfetchする', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(
      mockResponse(200, dlpResponseText('masked')) as never
    );

    deidentifyText({
      ...callParams,
      accessToken: 'my-token',
      projectId: 'my-project',
      infoTypes: ['PERSON_NAME', 'EMAIL_ADDRESS'],
      minLikelihood: 'LIKELY',
    });

    expect(UrlFetchApp.fetch).toHaveBeenCalledWith(
      'https://dlp.googleapis.com/v2/projects/my-project/locations/global/content:deidentify',
      expect.objectContaining({
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer my-token' },
        muteHttpExceptions: true,
      })
    );
    const [, options] = vi.mocked(UrlFetchApp.fetch).mock.calls[0];
    const payload = JSON.parse((options as { payload: string }).payload);
    expect(payload).toEqual({
      item: { value: 'hello user@example.com' },
      inspectConfig: {
        infoTypes: [{ name: 'PERSON_NAME' }, { name: 'EMAIL_ADDRESS' }],
        minLikelihood: 'LIKELY',
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
    });
  });

  it('空文字の場合はfetchせず空文字を返す', () => {
    const result = deidentifyText({ ...callParams, text: '' });

    expect(result).toBe('');
    expect(UrlFetchApp.fetch).not.toHaveBeenCalled();
  });

  it('非200エラー時はエラーを投げる', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(429, '') as never);

    expect(() => deidentifyText(callParams)).toThrow('DLP API error: HTTP 429');
    expect(UrlFetchApp.fetch).toHaveBeenCalledTimes(1);
    expect(Utilities.sleep).not.toHaveBeenCalled();
  });

  it('503エラー時にリトライして成功する', () => {
    vi.mocked(UrlFetchApp.fetch)
      .mockReturnValueOnce(mockResponse(503, '') as never)
      .mockReturnValueOnce(mockResponse(200, dlpResponseText('masked')) as never);

    const result = deidentifyText(callParams);

    expect(result).toBe('masked');
    expect(UrlFetchApp.fetch).toHaveBeenCalledTimes(2);
    expect(Utilities.sleep).toHaveBeenCalledTimes(1);
    expect(Utilities.sleep).toHaveBeenCalledWith(1000);
  });
});
