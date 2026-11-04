// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// NPCカモの造形と動作。親カモ（カモ大）1羽と子カモ（カモ小）5羽が水場のまわりで暮らす。
//
// 親カモは水場の岸を散歩し、ときどき水へ入って泳ぐ。陸か水かは「水場の中心からの距離」だけで
// 判定するので、目的地を水の中に選べば岸を越えてそのまま入水し、陸に選べば上がる。
//
// 子カモの隊列は、カモごとに違う「これ以上親へ近づかない距離」だけで作る。
// 1羽目は 0.5m、2羽目は 0.7m … と広げておくと、親が離れていくときに
// それぞれ自分の距離まで詰めるので、結果として親の後ろへ近い順の縦一列になる。
// 親から子へ近づくのは自由（子は下がらない）ため、親が寄ってきたときは隊列が崩れ、
// また離れると並び直す。追従の経路を記録しないので、崩れ方に自然なばらつきが出る。

import * as THREE from 'three';

import {
  type NPC定義,
  type NPC個体,
  type NPC更新引数,
  type NPC配置,
  type 手動操作状態,
  type 造形ヘルパー,
  乱数を作る,
  範囲乱数,
} from './AIチーム_NPC型';

/** 泳げる場所。中心と半径は 空間表示 側の 池を作る() に合わせる */
export type 水場 = { x: number; z: number; 半径: number };

/** 水面の高さ。池を作る() が水面を y=0.09 に置いているので、それに合わせる */
const 水面高さ = 0.09;

type カモ状態 = '散歩' | '泳ぐ' | '休む';

/** 親子で共通の見た目と速さ */
type カモ共通設定 = {
  /** 体格の倍率（カモ大=1、カモ小はこれを小さくする） */
  体格: number;
  /** 頭の大きさを体格から更に補正する。子カモは頭を大きめにすると雛らしく見える */
  頭径倍率: number;
  体色: number;
  頭色: number;
  くちばし色: number;
  水かき色: number;
  /** マガモのオスの白い首輪。不要なら null */
  首輪色: number | null;
  歩く速度: number;
  泳ぐ速度: number;
  水場: 水場 | null;
};

export type カモ大設定 = カモ共通設定 & {
  /** 岸からどれだけ外側まで散歩するか */
  散歩幅: number;
  /** 各状態の滞在時間 [最小秒, 最大秒] */
  滞在時間: Record<カモ状態, [number, number]>;
};

export type カモ小設定 = カモ共通設定 & {
  /** ついていく親カモ */
  親: THREE.Group | null;
  /** これより親へは近づかない距離。個体ごとに変えることで縦一列になる */
  最小距離: number;
  /** 最小距離をこれだけ超えたら全速で追いかける */
  焦り距離: number;
  /** 全速時に基本速度を何倍まで上げるか */
  最大焦り: number;
};

const 共通既定: Omit<カモ共通設定, '体格' | '頭径倍率' | '体色' | '頭色' | '首輪色'> = {
  くちばし色: 0xe8a33d,
  水かき色: 0xe0913a,
  歩く速度: 0.62,
  泳ぐ速度: 0.5,
  水場: null,
};

type カモ部位 = {
  /** 胴（この Group を上下させて、陸では脚の上・水では沈んだ高さに置く） */
  胴: THREE.Group;
  首: THREE.Group;
  脚: THREE.Group[];
  翼: THREE.Group[];
  /** 陸上での胴の高さ */
  陸上高さ: number;
  /** 水に浮いているときの胴の高さ */
  浮遊高さ: number;
};

/** カモの体を組む。前方は -z（ほかの NPC と同じ向き付け） */
const カモ体を組む = (
  設定: カモ共通設定,
  ヘルパー: 造形ヘルパー,
): { group: THREE.Group; 部位: カモ部位 } => {
  const { ジオメトリ, マテリアル } = ヘルパー;
  const s = 設定.体格;
  const 体長 = 0.62 * s;
  const 体幅 = 0.34 * s;
  const 体高 = 0.32 * s;
  const 頭径 = 0.135 * s * 設定.頭径倍率;
  const 脚長 = 0.13 * s;

  const 体材 = マテリアル(設定.体色, { roughness: 0.84, metalness: 0.02 });
  const 頭材 = マテリアル(設定.頭色, { roughness: 0.5, metalness: 0.14 });
  const 嘴材 = マテリアル(設定.くちばし色, { roughness: 0.48, metalness: 0.04 });
  const 足材 = マテリアル(設定.水かき色, { roughness: 0.6, metalness: 0.02 });
  const 目材 = マテリアル(0x141a1f, { roughness: 0.28, metalness: 0.05 });

  const group = new THREE.Group();
  const 胴 = new THREE.Group();

  // 胴体（丸みのある楕円体）
  const 胴体 = new THREE.Mesh(ジオメトリ(new THREE.SphereGeometry(体高 * 0.5, 16, 12)), 体材);
  胴体.scale.set(体幅 / 体高, 1, 体長 / 体高);
  胴.add(胴体);

  // 尾は尻から後ろへ出しつつ先を上へ跳ね上げる（カモらしいシルエットになる）
  const 尾 = new THREE.Mesh(
    ジオメトリ(new THREE.ConeGeometry(体高 * 0.27, 体長 * 0.36, 8)),
    体材,
  );
  尾.rotation.x = Math.PI * 0.39;
  尾.position.set(0, 体高 * 0.16, 体長 * 0.44);
  胴.add(尾);

  // 首（この Group を回して見回す）
  const 首 = new THREE.Group();
  首.position.set(0, 体高 * 0.3, -(体長 * 0.28));
  const 首本体 = new THREE.Mesh(
    ジオメトリ(new THREE.CapsuleGeometry(体高 * 0.17, 体高 * 0.4, 5, 10)),
    頭材,
  );
  首本体.position.y = 体高 * 0.3;
  首.add(首本体);

  if (設定.首輪色 !== null) {
    const 首輪 = new THREE.Mesh(
      ジオメトリ(new THREE.TorusGeometry(体高 * 0.18, 体高 * 0.045, 8, 16)),
      マテリアル(設定.首輪色, { roughness: 0.7 }),
    );
    首輪.rotation.x = Math.PI / 2;
    首輪.position.y = 体高 * 0.12;
    首.add(首輪);
  }

  const 頭 = new THREE.Mesh(ジオメトリ(new THREE.SphereGeometry(頭径, 14, 10)), 頭材);
  頭.scale.set(1, 0.96, 1.06);
  頭.position.y = 体高 * 0.58 + 頭径 * 0.5;
  首.add(頭);

  // くちばし（平たい板の先を少し丸める）
  const 嘴 = new THREE.Mesh(
    ジオメトリ(new THREE.BoxGeometry(頭径 * 0.66, 頭径 * 0.3, 頭径 * 1.0)),
    嘴材,
  );
  嘴.position.set(0, 頭.position.y - 頭径 * 0.18, -(頭径 * 1.12));
  首.add(嘴);
  const 嘴先 = new THREE.Mesh(ジオメトリ(new THREE.SphereGeometry(頭径 * 0.33, 10, 8)), 嘴材);
  嘴先.scale.set(1, 0.46, 0.7);
  嘴先.position.set(0, 嘴.position.y, -(頭径 * 1.6));
  首.add(嘴先);

  const 目形 = ジオメトリ(new THREE.SphereGeometry(頭径 * 0.15, 8, 6));
  [-1, 1].forEach((左右) => {
    const 目 = new THREE.Mesh(目形, 目材);
    目.position.set(左右 * 頭径 * 0.52, 頭.position.y + 頭径 * 0.16, -(頭径 * 0.68));
    首.add(目);
  });
  胴.add(首);

  // 翼（胴の左右に沿わせた平たい楕円体。羽ばたきで Group を回す）
  const 翼: THREE.Group[] = [];
  const 翼形 = ジオメトリ(new THREE.SphereGeometry(体高 * 0.42, 12, 9));
  [-1, 1].forEach((左右) => {
    const 翼Group = new THREE.Group();
    翼Group.position.set(左右 * 体幅 * 0.42, 体高 * 0.12, 体長 * 0.02);
    const 羽 = new THREE.Mesh(翼形, 体材);
    羽.scale.set(0.3, 0.72, 1.22);
    翼Group.add(羽);
    胴.add(翼Group);
    翼.push(翼Group);
  });

  // 脚（水かき付き。泳ぐときは隠す）
  const 脚: THREE.Group[] = [];
  const 脛形 = ジオメトリ(new THREE.CylinderGeometry(脚長 * 0.16, 脚長 * 0.14, 脚長 * 0.8, 6));
  const 水かき形 = ジオメトリ(new THREE.BoxGeometry(脚長 * 0.62, 脚長 * 0.1, 脚長 * 0.9));
  [-1, 1].forEach((左右) => {
    const 脚Group = new THREE.Group();
    脚Group.position.set(左右 * 体幅 * 0.26, -体高 * 0.38, 体長 * 0.04);
    const 脛 = new THREE.Mesh(脛形, 足材);
    脛.position.y = -脚長 * 0.4;
    脚Group.add(脛);
    const 水かき = new THREE.Mesh(水かき形, 足材);
    水かき.position.set(0, -脚長 * 0.82, -脚長 * 0.28);
    脚Group.add(水かき);
    胴.add(脚Group);
    脚.push(脚Group);
  });

  group.add(胴);
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  return {
    group,
    部位: {
      胴,
      首,
      脚,
      翼,
      陸上高さ: 脚長 + 体高 * 0.5,
      // 水面が胴の下半分を隠す高さ。浮いている見え方はここで決まる
      浮遊高さ: 水面高さ + 体高 * 0.18,
    },
  };
};

/** 水面に出す波紋。泳いでいるときだけ見せる */
const 波紋を作る = (体格: number, ヘルパー: 造形ヘルパー, scene: THREE.Scene) => {
  const 材質 = new THREE.MeshBasicMaterial({
    color: 0xdff2fb,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  ヘルパー.マテリアル登録(材質);
  const mesh = new THREE.Mesh(
    ヘルパー.ジオメトリ(new THREE.RingGeometry(0.2 * 体格, 0.34 * 体格, 20)),
    材質,
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  scene.add(mesh);
  return { mesh, 材質 };
};

/** 水場の中に居るか。陸と水の切り替えはこの判定だけで行う */
const 水の中か = (位置: THREE.Vector3, 水場: 水場 | null) =>
  水場 !== null && Math.hypot(位置.x - 水場.x, 位置.z - 水場.z) < 水場.半径;

/** 毎フレーム、行動側が返す指示 */
type カモの指示 = {
  /** 向かう先。null なら止まる */
  目的地: THREE.Vector3 | null;
  /** 速度の倍率（子カモが離れているとき急ぐために使う）。既定は 1 */
  速度倍率?: number;
};

/**
 * 造形・移動・アニメーションのうち、親子で共通の部分をまとめる。
 * 呼び出し側は毎フレーム「どこへ向かうか」と「どれだけ急ぐか」だけを決める。
 */
const カモを生成 = (
  種別: string,
  scene: THREE.Scene,
  ヘルパー: 造形ヘルパー,
  配置: NPC配置,
  設定: カモ共通設定,
  行動: (
    引数: NPC更新引数,
    状況: { 水中: boolean; 位置: THREE.Vector3 },
  ) => カモの指示,
): NPC個体 => {
  const { group, 部位 } = カモ体を組む(設定, ヘルパー);
  group.position.set(配置.位置.x, 0, 配置.位置.z);
  group.rotation.y = Math.random() * Math.PI * 2;
  scene.add(group);

  const 波紋 = 波紋を作る(設定.体格, ヘルパー, scene);
  const 位相 = Math.random() * Math.PI * 2;
  let 歩調 = 0;
  let 胴高さ = 部位.陸上高さ;
  // 一人称視点で操作されているあいだは、位置と向きを画面側に任せて見た目だけ合わせる
  let 手動: 手動操作状態 | null = null;

  const 更新 = (引数: NPC更新引数) => {
    const { delta, 時刻 } = 引数;
    const 水中 = 水の中か(group.position, 設定.水場);
    const { 目的地, 速度倍率 = 1 } = 手動
      ? { 目的地: null, 速度倍率: 1 }
      : 行動(引数, { 水中, 位置: group.position });

    // --- 移動 ---
    let 進んだ = 手動 ? 手動.速さ * delta : 0;
    if (目的地 && delta > 0) {
      const 差 = 目的地.clone().sub(group.position);
      差.y = 0;
      const 距離 = 差.length();
      if (距離 > 0.02) {
        差.normalize();
        const 速さ = (水中 ? 設定.泳ぐ速度 : 設定.歩く速度) * 速度倍率;
        進んだ = Math.min(距離, delta * 速さ);
        group.position.addScaledVector(差, 進んだ);
        // 泳ぐときは水の抵抗でゆったり向きを変える
        group.rotation.y = THREE.MathUtils.lerp(
          group.rotation.y,
          Math.atan2(差.x, 差.z) + Math.PI,
          水中 ? 0.06 : 0.14,
        );
      }
    }
    const 動いている = 進んだ > 1e-4;

    // --- 胴の高さ（陸 ⇄ 水面）。境目をまたぐときに段差が出ないよう補間する ---
    const 目標高さ = 水中 ? 部位.浮遊高さ : 部位.陸上高さ;
    胴高さ = THREE.MathUtils.lerp(胴高さ, 目標高さ, Math.min(1, Math.max(delta, 1 / 60) * 4));

    if (水中) {
      // 泳ぎ: 水面で細かく上下し、進むほど左右へ揺れる
      const 揺れ = Math.sin(時刻 * 0.0021 + 位相);
      部位.胴.position.y = 胴高さ + 揺れ * 0.012 * 設定.体格;
      部位.胴.rotation.z = 揺れ * 0.05;
      部位.胴.rotation.x = Math.sin(時刻 * 0.0016 + 位相) * 0.03;
      // 脚は水中で見えないので隠す（水かきが水面から飛び出すのを防ぐ）
      部位.脚.forEach((脚) => {
        脚.visible = false;
      });
    } else {
      // 歩き: カモらしく左右に体を振るヨタヨタ歩き
      if (動いている) 歩調 += delta * 9.5;
      const 振り = 動いている ? Math.sin(歩調) : 0;
      部位.胴.position.y = 胴高さ + Math.abs(振り) * 0.012 * 設定.体格;
      部位.胴.rotation.z = 振り * 0.15;
      部位.胴.rotation.x = 0;
      部位.脚.forEach((脚, index) => {
        脚.visible = true;
        const 目標 = 動いている ? Math.sin(歩調 + (index === 0 ? 0 : Math.PI)) * 0.5 : 0;
        脚.rotation.x = THREE.MathUtils.lerp(脚.rotation.x, 目標, 0.35);
      });
    }

    // 首は進んでいるとき前を向き、止まっているとゆっくり見回す
    部位.首.rotation.y = 動いている
      ? Math.sin(時刻 * 0.0009 + 位相) * 0.12
      : Math.sin(時刻 * 0.0005 + 位相) * 0.7;
    部位.首.rotation.x = Math.sin(時刻 * 0.0013 + 位相) * 0.05;

    // 翼はたまに軽く広げて羽ばたく（水浴びの身震い）
    const 羽ばたき中 = Math.sin(時刻 * 0.00031 + 位相) > 0.86;
    部位.翼.forEach((翼, index) => {
      const 左右 = index === 0 ? -1 : 1;
      const 目標 = 羽ばたき中 ? Math.sin(時刻 * 0.017) * 0.5 + 0.35 : 0;
      翼.rotation.z = THREE.MathUtils.lerp(翼.rotation.z, 左右 * 目標, 羽ばたき中 ? 0.3 : 0.08);
    });

    // 波紋は泳いでいるときだけ。進んでいるほど大きく広がる
    const 波紋濃さ = 水中 ? (動いている ? 0.5 : 0.26) : 0;
    波紋.材質.opacity = THREE.MathUtils.lerp(波紋.材質.opacity, 波紋濃さ, 0.08);
    波紋.mesh.visible = 波紋.材質.opacity > 0.02;
    if (波紋.mesh.visible) {
      波紋.mesh.position.set(group.position.x, 水面高さ + 0.006, group.position.z);
      const 広がり = 1 + (Math.sin(時刻 * 0.0024 + 位相) + 1) * (動いている ? 0.34 : 0.12);
      波紋.mesh.scale.setScalar(広がり);
    }
  };

  return {
    種別,
    group,
    更新,
    手動操作: (状態: 手動操作状態 | null) => {
      手動 = 状態;
    },
    // 水面では脚を使わずに滑るので、陸より速く進み、ヨタヨタ歩きの揺れも消える。
    // 体が沈むぶんだけ目線も下げる
    移動特性: () =>
      水の中か(group.position, 設定.水場)
        ? { 速さ倍率: 1.5, 揺れ倍率: 0.12, 目線補正: 部位.浮遊高さ - 部位.陸上高さ }
        : { 速さ倍率: 1, 揺れ倍率: 1, 目線補正: 0 },
  };
};

// --- 親カモ -------------------------------------------------------------------

/** 重み付きで次の状態を選ぶ。泳ぎ始めたら続けて泳ぎたがるようにしてある */
const 次の状態を選ぶ = (現在: カモ状態): カモ状態 => {
  const くじ = Math.random();
  if (現在 === '泳ぐ') return くじ < 0.5 ? '泳ぐ' : くじ < 0.88 ? '散歩' : '休む';
  if (現在 === '散歩') return くじ < 0.44 ? '泳ぐ' : くじ < 0.84 ? '散歩' : '休む';
  return くじ < 0.52 ? '散歩' : '泳ぐ';
};

export const カモ大定義: NPC定義<カモ大設定> = {
  種別: 'カモ大',
  既定設定: {
    ...共通既定,
    体格: 1,
    頭径倍率: 1,
    体色: 0x6f6250,
    頭色: 0x2f6f4d,
    首輪色: 0xf2efe6,
    散歩幅: 3.2,
    滞在時間: { 散歩: [7, 16], 泳ぐ: [12, 26], 休む: [4, 9] },
  },
  生成: (scene, ヘルパー, 配置, 設定): NPC個体 => {
    const 乱数 = 乱数を作る(配置.種 ?? 1);
    const 水場 = 設定.水場;

    /** 岸の外側（散歩）または水面の内側（泳ぐ）に目的地を取る */
    const 目的地を選ぶ = (状態: カモ状態): THREE.Vector3 => {
      if (!水場) return new THREE.Vector3(配置.位置.x, 0, 配置.位置.z);
      const 角度 = 乱数() * Math.PI * 2;
      const 距離 =
        状態 === '泳ぐ'
          ? 乱数() * 水場.半径 * 0.72
          : 水場.半径 + 0.7 + 乱数() * 設定.散歩幅;
      return new THREE.Vector3(
        水場.x + Math.cos(角度) * 距離,
        0,
        水場.z + Math.sin(角度) * 距離,
      );
    };

    let 状態: カモ状態 = '散歩';
    let 状態残り = 範囲乱数(設定.滞在時間.散歩);
    let 目的地: THREE.Vector3 | null = 目的地を選ぶ(状態);

    return カモを生成('カモ大', scene, ヘルパー, 配置, 設定, ({ delta }) => {
      if (delta <= 0) return { 目的地: null };
      状態残り -= delta;
      if (状態残り <= 0) {
        状態 = 次の状態を選ぶ(状態);
        状態残り = 範囲乱数(設定.滞在時間[状態]);
        目的地 = 状態 === '休む' ? null : 目的地を選ぶ(状態);
      }
      return { 目的地 };
    });
  },
};

// --- 子カモ -------------------------------------------------------------------

export const カモ小定義: NPC定義<カモ小設定> = {
  種別: 'カモ小',
  既定設定: {
    ...共通既定,
    // 体長 0.62 * 0.30 ≒ 0.19m。子カモどうしの車間（既定 0.2m 刻み）より短くして、
    // 縦一列に並んだときに体が重ならないようにしている
    体格: 0.3,
    頭径倍率: 1.35,
    体色: 0xd8c078,
    頭色: 0xe4d089,
    首輪色: null,
    くちばし色: 0xdf9a44,
    水かき色: 0xd98f3c,
    // 親より少し遅い。離れたときだけ 最大焦り 倍まで上げて追いつく
    歩く速度: 0.55,
    泳ぐ速度: 0.44,
    親: null,
    最小距離: 0.5,
    焦り距離: 0.9,
    最大焦り: 1.8,
  },
  生成: (scene, ヘルパー, 配置, 設定): NPC個体 =>
    カモを生成('カモ小', scene, ヘルパー, 配置, 設定, ({ delta }, { 位置 }) => {
      const 親 = 設定.親;
      if (!親 || delta <= 0) return { 目的地: null };

      const 差 = 親.position.clone().sub(位置);
      差.y = 0;
      const 距離 = 差.length();
      const 超過 = 距離 - 設定.最小距離;
      // 自分の最小距離まで詰めたら止まって待つ。
      // 親から近づいてくるのは自由にしたいので、近すぎても下がらない。
      if (超過 <= 0.02) return { 目的地: null };

      // まっすぐ親へ向かうだけにしている。横へ寄せる細工を足すと、距離の条件は
      // 親を中心とした円なので横向きには戻す力が働かず、ずれが溜まって隊列が崩れる。
      // 親を追いかける動きだけに任せておけば、常に後ろから寄ることになり縦一列が保たれ、
      // 親が向きを変えたときだけ各自の半径の違いで自然にばらける。
      差.normalize();
      // 最小距離のぶんだけ手前を目指す（親の位置そのものを目指すと追い越してしまう）
      const 目的地 = 親.position.clone().addScaledVector(差, -設定.最小距離);
      目的地.y = 0;

      return {
        目的地,
        // 離れているほど急ぐ。基本速度は親より少し遅いので、近いうちは自然に離されていく
        速度倍率: 1 + Math.min(設定.最大焦り, 超過 / 設定.焦り距離),
      };
    }),
};
