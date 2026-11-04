// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// NPCうさぎの造形と跳躍動作。
// 雑談エリアと休憩エリアの2つを遊び場にして、黒うさぎ（オス）と白うさぎ（メス）がぴょんぴょん跳ねる。
//
// 距離の制御は馬とまったく同じ考え方で、黒うさぎが主体になって自由に跳ね回り、
// 白うさぎは普段は独立して動き、黒うさぎから離れたときだけ急いで追いつく（追従開始距離 /
// 追従終了距離のヒステリシス）。距離の値だけはうさぎの体格と遊び場の広さに合わせて小さくしてある。
//
// 動きは馬と違い、跳躍1回ぶんを「踏み切り→空中→着地→ひと呼吸おく」の周期で進める。
// 進むのは空中にいるあいだだけで、向きを変えるのは着地しているあいだ、という作りにしてある。

import * as THREE from 'three';

import {
  type NPC定義,
  type NPC個体,
  type NPC更新引数,
  type NPC配置,
  type 手動操作状態,
  type 造形ヘルパー,
  範囲乱数,
} from './AIチーム_NPC型';

/** うさぎが跳ね回れる円。中心と半径は 空間表示 側のエリア円に合わせる */
export type 遊び場 = { x: number; z: number; 半径: number };

type うさぎ状態 = '跳ねる' | 'くつろぐ' | '毛づくろい' | '穴掘り';

type うさぎ設定 = {
  役割: '先導' | '追従';
  体格: number;
  体色: number;
  腹色: number;
  耳内色: number;
  尾色: number;
  /** 1回の跳躍で進む距離と、上がる高さ */
  跳躍距離: number;
  跳躍高さ: number;
  /** 1回の跳躍にかける秒数（小さいほど速く跳ぶ） */
  跳躍時間: number;
  /** 着地してから次に踏み切るまでの間 [最小秒, 最大秒] */
  着地間: [number, number];
  /** 各状態の滞在時間 [最小秒, 最大秒] */
  滞在時間: Record<うさぎ状態, [number, number]>;
  /** 跳ね回れるエリア円（複数渡すとエリア間を行き来する） */
  遊び場: 遊び場[];
  /** 掘り終えたときに呼ぶ。画面側が その場所へ うさぎ穴 NPC を置く。null なら穴を掘らない */
  穴を掘る: ((位置: THREE.Vector3) => void) | null;
  /** 次に穴を掘るまでの間隔 [最小秒, 最大秒] */
  穴掘り間隔: [number, number];
  /** 追いかける相手（白うさぎに黒うさぎを渡す） */
  追跡対象: THREE.Group | null;
  /** これより離れたら追い始める */
  追従開始距離: number;
  /** これより近づいたら追うのをやめる */
  追従終了距離: number;
};

/** エリアの地面パッチ上面の高さ（空間表示 側の 地面パッチを作る() に合わせる） */
const パッチ上面 = 0.09;

const 共通設定: Omit<うさぎ設定, '役割' | '体格' | '体色' | '腹色' | '耳内色' | '尾色'> = {
  跳躍距離: 0.62,
  跳躍高さ: 0.24,
  跳躍時間: 0.42,
  着地間: [0.1, 0.5],
  滞在時間: { 跳ねる: [4, 10], くつろぐ: [2, 6], 毛づくろい: [3, 7], 穴掘り: [4, 7] },
  遊び場: [],
  穴を掘る: null,
  // 穴は 10 分ほど残るので、2 匹で掘り続けても草原が穴だらけにならない間隔にしてある
  穴掘り間隔: [150, 320],
  追跡対象: null,
  // 馬（14 / 7）と同じ仕組みだが、うさぎは体も遊び場も小さいので値を縮めてある
  追従開始距離: 5,
  追従終了距離: 2,
};

type うさぎ部位 = {
  group: THREE.Group;
  胴: THREE.Group;
  頭: THREE.Group;
  耳: THREE.Group[];
  前脚: THREE.Group[];
  後脚: THREE.Group[];
  尾: THREE.Group;
  /** 立っているときの胴の高さ */
  立ち高さ: number;
};

/** うさぎの体を組む。前方は -z（ほかの NPC と同じ向き付け） */
const うさぎ体を作る = (ヘルパー: 造形ヘルパー, 設定: うさぎ設定): うさぎ部位 => {
  const { ジオメトリ, マテリアル } = ヘルパー;
  const s = 設定.体格;
  const 体長 = 0.36 * s;
  const 体幅 = 0.22 * s;
  const 体高 = 0.24 * s;
  const 頭径 = 0.115 * s;
  const 脚長 = 0.1 * s;

  const 体材 = マテリアル(設定.体色, { roughness: 0.93, metalness: 0.01 });
  const 腹材 = マテリアル(設定.腹色, { roughness: 0.93, metalness: 0.01 });
  const 耳内材 = マテリアル(設定.耳内色, { roughness: 0.82, metalness: 0.01 });
  const 尾材 = マテリアル(設定.尾色, { roughness: 0.96, metalness: 0.0 });
  const 目材 = マテリアル(0x18131a, { roughness: 0.26, metalness: 0.06 });
  const 鼻材 = マテリアル(0xe294a4, { roughness: 0.6, metalness: 0.01 });

  const group = new THREE.Group();
  const 立ち高さ = 脚長 * 0.6 + 体高 * 0.5;
  const 胴 = new THREE.Group();
  胴.position.y = 立ち高さ;

  // 胴体は前がすぼまり後ろが丸い卵形。腹側に明るい色を重ねてうさぎらしい2色にする
  const 胴体 = new THREE.Mesh(ジオメトリ(new THREE.SphereGeometry(体高 * 0.5, 16, 12)), 体材);
  胴体.scale.set(体幅 / 体高, 1, 体長 / 体高);
  胴.add(胴体);
  const 腹 = new THREE.Mesh(ジオメトリ(new THREE.SphereGeometry(体高 * 0.4, 14, 10)), 腹材);
  腹.scale.set((体幅 / 体高) * 0.92, 0.9, (体長 / 体高) * 0.9);
  腹.position.y = -体高 * 0.16;
  胴.add(腹);

  // 頭（胴の前上に載せる）
  const 頭 = new THREE.Group();
  頭.position.set(0, 体高 * 0.3, -(体長 * 0.42));
  const 顔 = new THREE.Mesh(ジオメトリ(new THREE.SphereGeometry(頭径, 16, 12)), 体材);
  顔.scale.set(1, 0.98, 1.06);
  頭.add(顔);
  const 口元 = new THREE.Mesh(ジオメトリ(new THREE.SphereGeometry(頭径 * 0.5, 12, 10)), 腹材);
  口元.scale.set(0.96, 0.78, 1.06);
  口元.position.set(0, -頭径 * 0.3, -頭径 * 0.62);
  頭.add(口元);
  const 鼻 = new THREE.Mesh(ジオメトリ(new THREE.SphereGeometry(頭径 * 0.13, 8, 6)), 鼻材);
  鼻.position.set(0, -頭径 * 0.18, -頭径 * 1.08);
  頭.add(鼻);
  // うさぎの目は顔の横寄りに付く
  const 目形 = ジオメトリ(new THREE.SphereGeometry(頭径 * 0.16, 8, 6));
  [-1, 1].forEach((左右) => {
    const 目 = new THREE.Mesh(目形, 目材);
    目.position.set(左右 * 頭径 * 0.72, 頭径 * 0.2, -頭径 * 0.38);
    頭.add(目);
  });

  // 長い耳（この Group を倒して、跳躍中は後ろへ寝かせる）
  const 耳: THREE.Group[] = [];
  const 耳形 = ジオメトリ(new THREE.CapsuleGeometry(頭径 * 0.26, 頭径 * 1.5, 4, 8));
  [-1, 1].forEach((左右) => {
    const 耳Group = new THREE.Group();
    耳Group.position.set(左右 * 頭径 * 0.4, 頭径 * 0.62, 頭径 * 0.14);
    耳Group.rotation.z = 左右 * 0.16;
    const 耳本体 = new THREE.Mesh(耳形, 体材);
    耳本体.scale.set(0.62, 1, 0.4);
    耳本体.position.y = 頭径 * 0.9;
    耳Group.add(耳本体);
    const 耳内 = new THREE.Mesh(耳形, 耳内材);
    耳内.scale.set(0.4, 0.86, 0.24);
    耳内.position.set(0, 頭径 * 0.9, -頭径 * 0.06);
    耳Group.add(耳内);
    頭.add(耳Group);
    耳.push(耳Group);
  });
  胴.add(頭);

  // 前脚（細くて短い。着地のときに先に着く）
  const 前脚: THREE.Group[] = [];
  const 前脚形 = ジオメトリ(new THREE.CapsuleGeometry(脚長 * 0.2, 脚長 * 0.68, 4, 8));
  const 前足形 = ジオメトリ(new THREE.SphereGeometry(脚長 * 0.22, 8, 6));
  [-1, 1].forEach((左右) => {
    const 脚Group = new THREE.Group();
    脚Group.position.set(左右 * 体幅 * 0.3, -体高 * 0.34, -体長 * 0.26);
    const 本体 = new THREE.Mesh(前脚形, 体材);
    本体.position.y = -脚長 * 0.38;
    脚Group.add(本体);
    const 足 = new THREE.Mesh(前足形, 腹材);
    足.scale.set(1, 0.72, 1.2);
    足.position.y = -脚長 * 0.72;
    脚Group.add(足);
    胴.add(脚Group);
    前脚.push(脚Group);
  });

  // 後脚（大きな腿と長い足。跳躍の踏み切りはここが目立つ）
  const 後脚: THREE.Group[] = [];
  const 腿形 = ジオメトリ(new THREE.SphereGeometry(体高 * 0.36, 12, 10));
  const 後足形 = ジオメトリ(new THREE.BoxGeometry(体幅 * 0.3, 脚長 * 0.3, 体長 * 0.44));
  [-1, 1].forEach((左右) => {
    const 脚Group = new THREE.Group();
    脚Group.position.set(左右 * 体幅 * 0.36, -体高 * 0.2, 体長 * 0.2);
    const 腿 = new THREE.Mesh(腿形, 体材);
    腿.scale.set(0.6, 1, 0.9);
    腿.position.y = -体高 * 0.08;
    脚Group.add(腿);
    const 足 = new THREE.Mesh(後足形, 腹材);
    足.position.set(0, -体高 * 0.38, -体長 * 0.08);
    脚Group.add(足);
    胴.add(脚Group);
    後脚.push(脚Group);
  });

  // 丸い尾
  const 尾 = new THREE.Group();
  尾.position.set(0, 体高 * 0.12, 体長 * 0.46);
  const 尾本体 = new THREE.Mesh(ジオメトリ(new THREE.SphereGeometry(体高 * 0.24, 10, 8)), 尾材);
  尾本体.scale.set(1, 0.94, 0.86);
  尾.add(尾本体);
  胴.add(尾);

  group.add(胴);
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  return { group, 胴, 頭, 耳, 前脚, 後脚, 尾, 立ち高さ };
};

const うさぎを生成 = (
  種別: string,
  scene: THREE.Scene,
  ヘルパー: 造形ヘルパー,
  配置: NPC配置,
  設定: うさぎ設定,
): NPC個体 => {
  const 部位 = うさぎ体を作る(ヘルパー, 設定);
  const { group } = 部位;
  const 禁止円 = 配置.禁止円 ?? [];
  const s = 設定.体格;

  /** いま乗っている地面の高さ（エリア円の中はパッチのぶんだけ高い） */
  const 地面高さ = (位置: THREE.Vector3) =>
    設定.遊び場.some((場) => Math.hypot(位置.x - 場.x, 位置.z - 場.z) < 場.半径 + 0.6)
      ? パッチ上面
      : 0;

  /** いちばん近い遊び場（ふだんはこの中で跳ねる） */
  const 最寄りの遊び場 = (): 遊び場 | null =>
    設定.遊び場.reduce<遊び場 | null>((近い, 場) => {
      if (!近い) return 場;
      const 今 = Math.hypot(group.position.x - 場.x, group.position.z - 場.z);
      const 前 = Math.hypot(group.position.x - 近い.x, group.position.z - 近い.z);
      return 今 < 前 ? 場 : 近い;
    }, null);

  /** 遊び場の中で、禁止円（テーブルやハンモック）を避けた次の目的地を選ぶ */
  const 目的地を選ぶ = (): THREE.Vector3 => {
    const 今の場 = 最寄りの遊び場();
    if (!今の場) return group.position.clone();
    for (let 試行 = 0; 試行 < 10; 試行 += 1) {
      // ふだんは今いるエリアの中で跳ね、ときどき隣のエリアへ移る
      const 場 =
        Math.random() < 0.78
          ? 今の場
          : (設定.遊び場[Math.floor(Math.random() * 設定.遊び場.length)] ?? 今の場);
      const 角度 = Math.random() * Math.PI * 2;
      const 距離 = Math.sqrt(Math.random()) * 場.半径;
      const 候補 = new THREE.Vector3(
        場.x + Math.cos(角度) * 距離,
        0,
        場.z + Math.sin(角度) * 距離,
      );
      const 禁止に入る = 禁止円.some(([x, z, r]) => Math.hypot(候補.x - x, 候補.z - z) < r);
      if (!禁止に入る) return 候補;
    }
    return group.position.clone();
  };

  let 状態: うさぎ状態 = '跳ねる';
  let 状態残り = 範囲乱数(設定.滞在時間.跳ねる);
  let 目的地 = 目的地を選ぶ();
  // 跳躍位相は 0〜1 が空中、-1 は着地している状態
  let 跳躍位相 = -1;
  let 着地残り = 範囲乱数(設定.着地間);
  let 追従中 = false;
  // 最初の 1 穴だけは早めに掘り、そのあとは 穴掘り間隔 をあける
  let 次の穴掘り時刻 = 範囲乱数([20, 70]);
  const 位相 = Math.random() * Math.PI * 2;

  group.position.set(配置.位置.x, 地面高さ(配置.位置), 配置.位置.z);
  group.rotation.y = Math.random() * Math.PI * 2;
  let 接地Y = group.position.y;
  scene.add(group);

  const 次の自由行動 = (経過時間: number) => {
    // 間隔があいていれば穴掘りを優先する（掘り終えるのは この状態が終わるとき）
    if (設定.穴を掘る && 経過時間 >= 次の穴掘り時刻) {
      状態 = '穴掘り';
      状態残り = 範囲乱数(設定.滞在時間.穴掘り);
      次の穴掘り時刻 = 経過時間 + 範囲乱数(設定.穴掘り間隔);
      return;
    }
    const くじ = Math.random();
    状態 = くじ < 0.62 ? '跳ねる' : くじ < 0.85 ? 'くつろぐ' : '毛づくろい';
    状態残り = 範囲乱数(設定.滞在時間[状態]);
    if (状態 === '跳ねる') 目的地 = 目的地を選ぶ();
  };

  /** 掘り終わり。鼻先の少し前に穴を空ける（自分が穴の真上に立たないように） */
  const 穴を空ける = () => {
    if (!設定.穴を掘る) return;
    // モデルの前方は -z。group.rotation.y には「進む向き + π」が入っている
    const 前x = -Math.sin(group.rotation.y);
    const 前z = -Math.cos(group.rotation.y);
    設定.穴を掘る(
      new THREE.Vector3(
        group.position.x + 前x * 0.45,
        地面高さ(group.position),
        group.position.z + 前z * 0.45,
      ),
    );
  };

  // 一人称視点で操作されているあいだは、位置と向きを画面側に任せて見た目だけ合わせる
  let 手動: 手動操作状態 | null = null;

  const 更新 = ({ 経過時間, delta, 時刻 }: NPC更新引数) => {
    if (delta <= 0) return;

    if (手動) {
      // 跳ねる周期だけ回す。前後左右の移動は画面側が動かす
      状態 = '跳ねる';
      状態残り = 1;
      追従中 = false;
      if (手動.速さ > 0.05) {
        if (跳躍位相 < 0) {
          着地残り -= delta * (手動.全力 ? 1.6 : 1);
          if (着地残り <= 0) 跳躍位相 = 0;
        } else {
          跳躍位相 += delta / 設定.跳躍時間;
          if (跳躍位相 >= 1) {
            跳躍位相 = -1;
            着地残り = 範囲乱数(設定.着地間);
          }
        }
      } else if (跳躍位相 >= 0) {
        跳躍位相 += delta / 設定.跳躍時間;
        if (跳躍位相 >= 1) {
          跳躍位相 = -1;
          着地残り = 範囲乱数(設定.着地間);
        }
      }
      見た目を更新(delta, 時刻);
      return;
    }

    // --- 白うさぎの追従（馬と同じヒステリシス。離れたら追い、近づいたらやめる）---
    if (設定.役割 === '追従' && 設定.追跡対象) {
      const 相手 = 設定.追跡対象.position;
      const 相手距離 = Math.hypot(group.position.x - 相手.x, group.position.z - 相手.z);
      if (相手距離 > 設定.追従開始距離) 追従中 = true;
      if (相手距離 < 設定.追従終了距離) 追従中 = false;
      if (追従中) {
        状態 = '跳ねる';
        状態残り = 1.2;
        // 真後ろに付かず、少し横へずれた位置を狙う（つかず離れず）
        目的地 = new THREE.Vector3(
          相手.x + Math.sin(時刻 * 0.0011) * 0.9,
          0,
          相手.z + Math.cos(時刻 * 0.0013) * 0.9,
        );
      }
    }

    状態残り -= delta;
    if (!追従中 && 状態残り <= 0) {
      // 穴掘りをやりきったときだけ穴が空く（追従で中断されたときは空かない）
      if (状態 === '穴掘り') 穴を空ける();
      次の自由行動(経過時間);
    }

    // --- 跳躍（進むのは空中だけ、向きを変えるのは着地しているあいだだけ）---
    const 急ぎ = 追従中 ? 1.55 : 1;
    if (状態 === '跳ねる') {
      const 差 = 目的地.clone().sub(group.position);
      差.y = 0;
      const 距離 = 差.length();
      if (距離 < 0.2 && 跳躍位相 < 0) {
        if (!追従中) 次の自由行動(経過時間);
      } else {
        差.normalize();
        if (跳躍位相 < 0) {
          // 着地中：目的地の方向へ向き直りながら、次の踏み切りを待つ
          const 目標角 = Math.atan2(差.x, 差.z) + Math.PI;
          // 近いほうへ回りたいので、角度差を -π〜π に畳んでから寄せる
          const 角度差 =
            ((((目標角 - group.rotation.y + Math.PI) % (Math.PI * 2)) + Math.PI * 2) %
              (Math.PI * 2)) -
            Math.PI;
          group.rotation.y += 角度差 * Math.min(1, delta * 12);
          着地残り -= delta * 急ぎ;
          if (着地残り <= 0) 跳躍位相 = 0;
        } else {
          跳躍位相 += delta / 設定.跳躍時間;
          const 速さ = (設定.跳躍距離 * 急ぎ) / 設定.跳躍時間;
          group.position.addScaledVector(差, Math.min(距離, 速さ * delta));
          if (跳躍位相 >= 1) {
            跳躍位相 = -1;
            着地残り = 範囲乱数(設定.着地間);
          }
        }
      }
    } else if (跳躍位相 >= 0) {
      // 跳ねるのをやめたら、いま跳んでいるぶんだけ着地させる
      跳躍位相 += delta / 設定.跳躍時間;
      if (跳躍位相 >= 1) {
        跳躍位相 = -1;
        着地残り = 範囲乱数(設定.着地間);
      }
    }

    見た目を更新(delta, 時刻);
  };

  /** 跳躍の位相と状態から各部位を動かす。自律行動でも一人称操作でも共通 */
  function 見た目を更新(delta: number, 時刻: number) {
    const 空中 = 跳躍位相 >= 0;
    const p = 空中 ? 跳躍位相 : 0;
    // 山は 0→1→0。高さも各部位の振りもこのカーブで作る
    const 山 = Math.sin(Math.PI * p);
    const 呼吸 = Math.sin(時刻 * 0.0027 + 位相);

    接地Y = THREE.MathUtils.lerp(接地Y, 地面高さ(group.position), Math.min(1, delta * 6));
    group.position.y = 接地Y + 山 * 設定.跳躍高さ;

    // 穴掘り中は前かがみになって、前脚を左右交互にすばやく掻く
    const 穴掘り中 = 状態 === '穴掘り' && !空中;
    const 掻き = Math.sin(時刻 * 0.026);

    // 踏み切りで前を上げ、着地で前を下げる
    const 目標胴傾き = 空中
      ? -Math.sin(Math.PI * 2 * p) * 0.3
      : 穴掘り中
        ? 0.34
        : 状態 === '毛づくろい'
          ? 0.12
          : 呼吸 * 0.012;
    部位.胴.rotation.x = THREE.MathUtils.lerp(部位.胴.rotation.x, 目標胴傾き, 0.3);
    部位.胴.rotation.z = THREE.MathUtils.lerp(
      部位.胴.rotation.z,
      穴掘り中 ? 掻き * 0.09 : 0,
      0.25,
    );
    部位.胴.position.y =
      部位.立ち高さ + 呼吸 * 0.005 * s - (穴掘り中 ? 0.035 * s : 0);

    // 後脚は踏み切りで後ろへ伸び、空中で前へたたまれて着地に備える
    部位.後脚.forEach((脚) => {
      const 目標 = 空中 ? Math.cos(Math.PI * p) * 0.8 : 穴掘り中 ? -0.18 : 0;
      脚.rotation.x = THREE.MathUtils.lerp(脚.rotation.x, 目標, 0.32);
    });
    部位.前脚.forEach((脚, index) => {
      const 目標 = 空中
        ? -Math.cos(Math.PI * p) * 0.7
        : 穴掘り中
          ? -0.75 + Math.sin(時刻 * 0.026 + index * Math.PI) * 0.85
          : 状態 === '毛づくろい'
            ? -0.55 - Math.abs(Math.sin(時刻 * 0.006 + index)) * 0.3
            : 0;
      脚.rotation.x = THREE.MathUtils.lerp(脚.rotation.x, 目標, 穴掘り中 ? 0.55 : 0.3);
    });

    // 耳は跳んでいるあいだ後ろへ寝かせ、止まっているときはときどきぴくりと動かす
    部位.耳.forEach((耳, index) => {
      const ぴく =
        Math.sin(時刻 * 0.00041 + 位相 + index * 1.7) > 0.9
          ? Math.sin(時刻 * 0.021) * 0.26
          : 0;
      const 目標 = 空中
        ? 山 * 0.5
        : 穴掘り中
          ? 0.3 + 掻き * 0.12
          : (状態 === '毛づくろい' ? 0.42 : 0) + ぴく;
      耳.rotation.x = THREE.MathUtils.lerp(耳.rotation.x, 目標, 0.28);
    });

    // 頭は跳ぶとき前を見上げ、穴掘り・毛づくろい中は下げ、くつろぐときは左右を見回す
    const 目標頭傾き = 空中
      ? -山 * 0.16
      : 穴掘り中
        ? 0.62
        : 状態 === '毛づくろい'
          ? 0.55
          : 呼吸 * 0.05;
    部位.頭.rotation.x = THREE.MathUtils.lerp(部位.頭.rotation.x, 目標頭傾き, 0.28);
    部位.頭.rotation.y = THREE.MathUtils.lerp(
      部位.頭.rotation.y,
      状態 === 'くつろぐ' && !空中 ? Math.sin(時刻 * 0.0008 + 位相) * 0.55 : 0,
      0.08,
    );

    // 尾は着地のたびに小さく跳ねる
    部位.尾.rotation.x = THREE.MathUtils.lerp(
      部位.尾.rotation.x,
      空中 ? -山 * 0.35 : Math.sin(時刻 * 0.004 + 位相) * 0.08,
      0.25,
    );
  }

  // うさぎは跳んでいるあいだしか前へ進めない。地面にいるときに進むと滑って見えるので、
  // 空中の割合ぶんだけ速く飛ばして、ならすと指定どおりの速さになるようにする
  const 空中割合 =
    設定.跳躍時間 / (設定.跳躍時間 + (設定.着地間[0] + 設定.着地間[1]) / 2);

  return {
    種別,
    group,
    更新,
    手動操作: (状態指定: 手動操作状態 | null) => {
      手動 = 状態指定;
      if (!状態指定) {
        状態残り = 0;
        目的地 = group.position.clone();
      }
    },
    移動特性: () => ({ 速さ倍率: 跳躍位相 >= 0 ? 1 / 空中割合 : 0 }),
  };
};

export const 黒うさぎ定義: NPC定義<うさぎ設定> = {
  種別: '黒うさぎ',
  // オス。体が少し大きく、白うさぎより一歩ぶん遠くまで跳ぶ
  既定設定: {
    ...共通設定,
    役割: '先導',
    体格: 1,
    体色: 0x1f1d24,
    腹色: 0x3a3743,
    耳内色: 0x6c4b55,
    尾色: 0x413e4a,
  },
  生成: (scene, ヘルパー, 配置, 設定) => うさぎを生成('黒うさぎ', scene, ヘルパー, 配置, 設定),
};

export const 白うさぎ定義: NPC定義<うさぎ設定> = {
  種別: '白うさぎ',
  // メス。ひとまわり小さく、跳躍も細かい
  既定設定: {
    ...共通設定,
    役割: '追従',
    体格: 0.88,
    体色: 0xf5f2e9,
    腹色: 0xfffdf6,
    耳内色: 0xf0b3c0,
    尾色: 0xfffdf6,
    跳躍距離: 0.52,
    跳躍高さ: 0.2,
    跳躍時間: 0.38,
    着地間: [0.12, 0.55],
  },
  生成: (scene, ヘルパー, 配置, 設定) => うさぎを生成('白うさぎ', scene, ヘルパー, 配置, 設定),
};
