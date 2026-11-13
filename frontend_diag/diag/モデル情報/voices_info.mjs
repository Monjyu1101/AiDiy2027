// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
export const LIVE_VOICES_FILE = 'live_voices_info.json';

const LIVE_GEMINI_VOICES = Object.freeze({
  "Zephyr": "(2.5) Zephyr Female",
  "Puck": "(2.0) Puck",
  "Charon": "(2.0) Charon",
  "Kore": "(2.0) Kore Female",
  "Fenrir": "(2.0) Fenrir",
  "Leda": "(2.5) Leda Female",
  "Orus": "(2.5) Orus",
  "Aoede": "(2.0) Aoede Female",
  "Callirrhoe": "Callirrhoe Female",
  "Autonoe": "Autonoe Female",
  "Enceladus": "Enceladus",
  "Lapetus": "Lapetus",
  "Umbriel": "Umbriel",
  "Algieba": "Algieba",
  "Despina": "Despina Female",
  "Erinome": "Erinome Female",
  "Algenib": "Algenib",
  "Rasalgethi": "Rasalgethi",
  "Laomedeia": "Laomedeia Female",
  "Achernar": "Achernar Female",
  "Alnilam": "Alnilam",
  "Schedar": "Schedar",
  "Gacrux": "Gacrux Female",
  "Pulcherrima": "Pulcherrima",
  "Achird": "Achird",
  "Zubenelgenubi": "Zubenelgenubi",
  "Vindemiatrix": "Vindemiatrix Female",
  "Sadachbia": "Sadachbia",
  "Sadaltager": "Sadaltager",
  "Sulafat": "Sulafat Female"
});

const LIVE_OPENAI_VOICES = Object.freeze({
  "marin": "Marin Female",
  "alloy": "Alloy Female",
  "ash": "Ash",
  "ballad": "Ballad Female",
  "cedar": "Cedar",
  "coral": "Coral Female",
  "echo": "Echo",
  "fable": "Fable",
  "nova": "Nova Female",
  "onyx": "Onyx",
  "sage": "Sage Female",
  "shimmer": "Shimmer Female",
  "verse": "Verse Female"
});

// 音声候補は取得・認証状態にかかわらず3区分とも公開する。FreeAIはGeminiと同じ定義。
export function liveVoicesInfo() {
  const voices = {};
  for (const id of ['freeai', 'gemini', 'openai']) {
    voices[id + '_live'] = {voices:{...(id === 'openai' ? LIVE_OPENAI_VOICES : LIVE_GEMINI_VOICES)}};
  }
  return voices;
}
