// エントリーポイント
// GAS の doPost など公開関数はここから export する

declare const global: {
  doPost: (e: GoogleAppsScript.Events.DoPost) => GoogleAppsScript.Content.TextOutput;
};

global.doPost = (_e) => {
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(
    ContentService.MimeType.JSON
  );
};
