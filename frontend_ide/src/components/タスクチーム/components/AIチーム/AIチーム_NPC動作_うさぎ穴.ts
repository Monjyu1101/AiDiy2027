// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// NPCうさぎ穴。うさぎが掘った穴で、10分ほど残ったあと自然に埋まって消える。
//
// ほかの NPC と違い、画面の初期化時ではなく、うさぎが掘るたびに動的に生まれる。
// そのため造形ヘルパー（画面側の破棄リスト）は使わず、資源は自分で持って消えるときに破棄する。
// ヘルパーに積んでしまうと、長時間動かしたときに使われない資源が溜まっていってしまう。
//
// 要員がはまる判定に使う半径は group.userData.穴半径 に入れてある。
// 掘り上がる途中と埋まりかけでは小さくなり、消える瞬間は 0 になる。

import * as THREE from 'three';

import { type NPC定義, type NPC個体, 乱数を作る } from './AIチーム_NPC型';

type うさぎ穴設定 = {
  半径: number;
  /** 掘られてから埋まりきるまでの秒数 */
  寿命秒: number;
  /** 掘り上がるまでの秒数（この間に穴が開いていく） */
  掘り上がり秒: number;
  /** 最後にすぼまって埋まっていく秒数 */
  埋まり秒: number;
  土色: number;
  穴色: number;
};

export const うさぎ穴定義: NPC定義<うさぎ穴設定> = {
  種別: 'うさぎ穴',
  既定設定: {
    半径: 0.62,
    寿命秒: 600,
    掘り上がり秒: 1.2,
    埋まり秒: 45,
    土色: 0x9a7346,
    穴色: 0x241b13,
  },
  生成: (scene, _ヘルパー, 配置, 設定): NPC個体 => {
    const 乱数 = 乱数を作る(配置.種 ?? 1);
    const 資源: Array<THREE.BufferGeometry | THREE.Material> = [];
    const 登録 = <T extends THREE.BufferGeometry | THREE.Material>(もの: T): T => {
      資源.push(もの);
      return もの;
    };

    const 土材 = 登録(
      new THREE.MeshStandardMaterial({ color: 設定.土色, roughness: 0.96, metalness: 0.01 }),
    );
    const 穴材 = 登録(
      new THREE.MeshStandardMaterial({ color: 設定.穴色, roughness: 1, metalness: 0 }),
    );

    const group = new THREE.Group();
    // 配置.位置.y は掘った場所の地面の高さ（エリアの地面パッチは少し高い）
    group.position.set(配置.位置.x, 配置.位置.y, 配置.位置.z);
    group.rotation.y = 乱数() * Math.PI * 2;
    group.userData.うさぎ穴 = true;
    group.userData.穴半径 = 0;

    // 穴の底。地面は掘り抜けないので、暗い円を地面のすぐ上に敷いて穴に見せる
    const 底 = new THREE.Mesh(登録(new THREE.CircleGeometry(設定.半径, 24)), 穴材);
    底.rotation.x = -Math.PI / 2;
    底.position.y = 0.012;
    底.receiveShadow = true;
    group.add(底);

    // 掘り出した土の縁。輪を寝かせたうえで管をつぶし、盛り土らしい高さに抑える
    const 縁 = new THREE.Mesh(
      登録(new THREE.TorusGeometry(設定.半径 * 1.04, 設定.半径 * 0.3, 8, 22)),
      土材,
    );
    縁.rotation.x = -Math.PI / 2;
    縁.scale.z = 0.44;
    縁.position.y = 0.02;
    縁.castShadow = true;
    縁.receiveShadow = true;
    group.add(縁);

    // 縁の外に散った土のかたまり
    const 土塊形 = 登録(new THREE.DodecahedronGeometry(設定.半径 * 0.2, 0));
    for (let index = 0; index < 5; index += 1) {
      const 角度 = (index / 5) * Math.PI * 2 + 乱数() * 0.8;
      const 距離 = 設定.半径 * (1.3 + 乱数() * 0.55);
      const 土塊 = new THREE.Mesh(土塊形, 土材);
      土塊.position.set(Math.cos(角度) * 距離, 0.05, Math.sin(角度) * 距離);
      土塊.scale.set(1, 0.6 + 乱数() * 0.3, 0.9);
      土塊.rotation.set(乱数(), 乱数() * 3, 乱数());
      土塊.castShadow = true;
      土塊.receiveShadow = true;
      group.add(土塊);
    }

    scene.add(group);

    let 経過 = 0;
    let 終了 = false;

    const 片付け = () => {
      if (終了) return;
      終了 = true;
      group.userData.穴半径 = 0;
      scene.remove(group);
      資源.forEach((もの) => もの.dispose());
    };

    const 更新 = ({ delta }: { delta: number }) => {
      if (終了) return;
      経過 += delta;
      const 開き = Math.min(1, 経過 / 設定.掘り上がり秒);
      const 残り = 設定.寿命秒 - 経過;
      // 最後は縁ごとすぼまって、埋め戻されたように消える
      const 閉じ = 残り < 設定.埋まり秒 ? Math.max(0, 残り / 設定.埋まり秒) : 1;
      const 大きさ = 開き * 閉じ;
      group.scale.setScalar(Math.max(大きさ, 0.001));
      group.visible = 大きさ > 0.02;
      // 落ちる判定は見た目より内側。縁の盛り土を踏んだくらいでははまらない
      group.userData.穴半径 = 設定.半径 * 大きさ * 0.82;

      if (残り <= 0) 片付け();
    };

    return { 種別: 'うさぎ穴', group, 更新, 寿命切れ: () => 終了, 破棄: 片付け };
  },
};
