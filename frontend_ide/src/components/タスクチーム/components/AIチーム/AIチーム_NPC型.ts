// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// NPC（草原に住むもの）共通の型。
//
// この画面の NPC は「動作モジュール」ごとにファイルを分けている。
//   AIチーム_NPC制御.ts        … 種別の登録表と、配置 / 更新の入口
//   AIチーム_NPC四足.ts        … ネコ・イヌ共通の四足エンジン
//   AIチーム_NPC動作_ネコ.ts   … ネコの体格・色・行動パラメータ
//   AIチーム_NPC動作_イヌ.ts   … イヌの体格・色・行動パラメータ
//   AIチーム_NPC動作_馬.ts     … 黒馬・白馬の造形と放牧まわりの動作
//   AIチーム_NPC動作_うさぎ.ts … 黒うさぎ・白うさぎの造形とぴょんぴょん跳ねる動作
//   AIチーム_NPC動作_うさぎ穴.ts … うさぎが掘った穴（時間で埋まって消える）
//   AIチーム_NPC動作_カモ.ts   … 親カモ・子カモの造形と水場まわりの動作
//   AIチーム_NPC動作_雲.ts     … 雲の造形と流れる動作
//   AIチーム_NPC動作_蝶.ts     … 蝶の造形と旋回・羽ばたき

import type * as THREE from 'three';

/** 造形時に生成したリソースを画面側の破棄リストへ登録するための受け口 */
export type 造形ヘルパー = {
  ジオメトリ: <T extends THREE.BufferGeometry>(geometry: T) => T;
  マテリアル: (
    color: number,
    options?: THREE.MeshStandardMaterialParameters,
  ) => THREE.MeshStandardMaterial;
  マテリアル登録: (material: THREE.Material) => void;
  テクスチャ登録: (texture: THREE.Texture) => void;
};

/** 配置の指定。位置の意味は種別ごと（四足は立ち位置、雲・蝶は中心） */
export type NPC配置 = {
  位置: THREE.Vector3;
  /** 見た目のばらつきを決める乱数シード */
  種?: number;
  /** 近づかない円 [x, z, 半径]。四足の目的地選びで使う */
  禁止円?: [number, number, number][];
};

/** 毎フレームの更新引数 */
export type NPC更新引数 = {
  /** シミュレーション上の累計秒（一時停止中は増えない） */
  経過時間: number;
  /** このフレームの進み（一時停止中は 0） */
  delta: number;
  /** performance.now()。一時停止中も動く演出に使う */
  時刻: number;
  camera: THREE.Camera;
  /**
   * 俯瞰カメラの位置。一人称視点のあいだも動かない。
   * 放牧地のように「見る側の位置から配置を決める」用途はこちらを使う
   * （camera を使うと、その生き物に乗って移動した瞬間に配置ごと動いてしまう）。
   */
  俯瞰位置: THREE.Vector3;
};

/**
 * 一人称視点で操作されているあいだ、画面側から毎フレーム渡す状態。
 * 位置と向きは画面側が持つので、NPC 側は「その速さで移動している見た目」だけ合わせればよい。
 */
export type 手動操作状態 = {
  /** いま進んでいる速さ（m/秒）。0 なら止まっている */
  速さ: number;
  /** 全力で移動しているか（馬の駆け足など） */
  全力: boolean;
};

/** 配置済みの NPC 1 体 */
export type NPC個体 = {
  種別: string;
  group: THREE.Group;
  更新: (引数: NPC更新引数) => void;
  /**
   * true を返すと NPC群を更新 が一覧から外す。
   * うさぎ穴のように、途中で生まれて途中で消える NPC だけが持つ。
   * シーンからの取り外しと資源の破棄は、返す前に自分で済ませておく。
   */
  寿命切れ?: () => boolean;
  /**
   * 画面を閉じるときに呼ばれる後片付け。
   * 造形ヘルパー（画面側の破棄リスト）を使わずに資源を持っている NPC だけが実装する。
   */
  破棄?: () => void;
  /**
   * 一人称視点での操作を受け付ける NPC が実装する。
   * 状態を渡すと自律行動をやめてその速さの見た目になり、null を渡すと自律行動へ戻る。
   */
  手動操作?: (状態: 手動操作状態 | null) => void;
  /**
   * 一人称操作中の、いまの動きの性質。足場や体勢で変わる相手だけが実装する
   * （うさぎは跳んでいるあいだしか進めず、カモは水面だとすいすい進んで揺れない）。
   */
  移動特性?: () => 手動移動特性;
};

/** 一人称操作中の、いまの動きの性質。書かない項目は既定のまま */
export type 手動移動特性 = {
  /** 前へ進む速さの倍率。既定 1、0 でその場に留まる */
  速さ倍率?: number;
  /** 頭の揺れの強さの倍率。既定 1、0 で揺れない */
  揺れ倍率?: number;
  /** 目線の高さの補正（m）。水に浮いて体が沈むぶんなどに使う */
  目線補正?: number;
};

/** 種別ごとの動作モジュールが公開する定義 */
export type NPC定義<設定> = {
  種別: string;
  既定設定: 設定;
  生成: (
    scene: THREE.Scene,
    ヘルパー: 造形ヘルパー,
    配置: NPC配置,
    設定: 設定,
  ) => NPC個体;
};

/** シード付き擬似乱数（同じシードなら毎回同じ見た目になる） */
export const 乱数を作る = (seed: number) => {
  let state = (seed || 1) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** [最小, 最大] の範囲で乱数を返す */
export const 範囲乱数 = ([最小, 最大]: [number, number]) => 最小 + Math.random() * (最大 - 最小);
