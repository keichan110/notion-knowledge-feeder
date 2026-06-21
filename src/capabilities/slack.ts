export type SlackBotToken = string & { readonly __brand: 'SlackBotToken' };
export type SlackChannelId = string & { readonly __brand: 'SlackChannelId' };
export type SlackPostMessageParams = {
  text: string;
  blocks?: unknown[];
  threadTs?: string;
};

/**
 * Slack Web API `chat.postMessage` でメッセージを投稿する。
 * @param botToken Slack Bot User OAuth Token
 * @param channel 投稿先SlackチャンネルID
 * @param params 投稿する本文と任意のBlock Kit・スレッド指定
 * @returns 投稿されたSlackメッセージのts
 */
export function postMessage(
  botToken: SlackBotToken,
  channel: SlackChannelId,
  params: SlackPostMessageParams
): string {
  const payload: { channel: SlackChannelId; text: string; blocks?: unknown[]; thread_ts?: string } =
    {
      channel,
      text: params.text,
    };
  if (params.blocks) payload.blocks = params.blocks;
  if (params.threadTs) payload.thread_ts = params.threadTs;

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${botToken}` },
    payload: JSON.stringify(payload),
  };
  const res = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', options);
  const body = JSON.parse(res.getContentText()) as { ok: boolean; error?: string; ts: string };
  if (!body.ok) {
    throw new Error(`slack postMessage failed: ${body.error ?? 'unknown'}`);
  }
  return body.ts;
}
