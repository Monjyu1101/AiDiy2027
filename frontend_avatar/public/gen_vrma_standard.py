#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""
AiDiy VRMA Generator - standard idle/fidget animation (single file)
Output: frontend_avatar/public/vrma/標準/VRMA_01.vrma

Corrected Arm Directions (A-pose base).
Left Arm: -Z rotation to go down.
Right Arm: +Z rotation to go down.

60秒ループ / 30fps → フレーム数は旧版(30s/60fps)と同じ 1801 frames
P60 の超低速ドリフトにより、前半30秒と後半30秒で異なる雰囲気を演出。
全身（胴・背骨・首・頭・両腕・両前腕・両手首・12本の指）を網羅。
"""

import struct, json, math, os

DURATION = 60.0   # ← 60秒ループ（全周期が60の約数 → 完全ループ）
FPS = 30          # 30fps → N = 1801 フレーム（旧 60fps/30s と同数）
N = int(FPS * DURATION) + 1
TIMES = [i / FPS for i in range(N)]

# Periods — 全て DURATION(60.0) の約数 → 完全ループ
P60  = 60.0   #  1 cycle / 60s : 超ゆっくりドリフト（前後半で雰囲気変化）
P30  = 30.0   #  2 cycles/ 60s : ゆったりスウェイ
P20  = 20.0   #  3 cycles/ 60s : ゆらゆら体揺れ
P12  = 12.0   #  5 cycles/ 60s : 中速スウェイ
P6   =  6.0   # 10 cycles/ 60s : 通常スウェイ
P4   =  4.0   # 15 cycles/ 60s : リズム・軽いもじもじ
P3   =  3.0   # 20 cycles/ 60s : もじもじ
P2   =  2.0   # 30 cycles/ 60s : 指先・手首の細かい揺れ

PI = math.pi
H  = math.pi / 2   # 90°
Q  = math.pi / 4   # 45°
T  = math.pi / 3   # 60°
S  = math.pi / 6   # 30°
E  = math.pi / 5   # 36°

# ---- quaternion math -------------------------------------------------------
def qy(a): s=math.sin(a/2); return [0.,s,0.,math.cos(a/2)]
def qx(a): s=math.sin(a/2); return [s,0.,0.,math.cos(a/2)]
def qz(a): s=math.sin(a/2); return [0.,0.,s,math.cos(a/2)]

def qmul(a, b):
    ax,ay,az,aw = a; bx,by,bz,bw = b
    return [aw*bx+ax*bw+ay*bz-az*by,
            aw*by-ax*bz+ay*bw+az*bx,
            aw*bz+ax*by-ay*bx+az*bw,
            aw*bw-ax*bx-ay*by-az*bz]

def qnorm(q):
    l = math.sqrt(sum(x*x for x in q))
    return [x/l for x in q] if l > 1e-10 else [0.,0.,0.,1.]

AXIS_FN = {'rx': qx, 'ry': qy, 'rz': qz}

def compute_rotations(spec, base_rot=None):
    result = []
    base_rot = base_rot or []
    for t in TIMES:
        q = [0.,0.,0.,1.]
        # 1. Base Pose
        for axis, angle_deg in base_rot:
            q = qmul(q, AXIS_FN[axis](math.radians(angle_deg)))
        # 2. Animation Layers
        for axis, amp, period, phase in spec:
            angle = math.radians(amp) * math.sin(2*math.pi*t/period + phase)
            q = qmul(q, AXIS_FN[axis](angle))
        result.append(qnorm(q))
    return result

HIPS_REST_Y = 0.9

def compute_translations(spec, base=None):
    base = base or [0., 0., 0.]
    result = []
    for t in TIMES:
        pos = list(base)
        for item in spec:
            axis, amp, period, phase = item[:4]
            waveform = item[4] if len(item) > 4 else 'sin'
            if waveform == 'down':
                # 下方向のみバウンス: 0(安静) → -amp(最大しゃがみ) → 0
                val = -abs(amp) * (1 - math.cos(2*math.pi*t/period + phase)) / 2
            else:
                val = amp * math.sin(2*math.pi*t/period + phase)
            pos[{'x':0,'y':1,'z':2}[axis]] += val
        result.append(pos)
    return result

# ---- GLB builder -----------------------------------------------------------
def build_glb(rot_configs, trans_configs=None, anim_name="idle"):
    trans_configs = trans_configs or {}
    all_names = list(dict.fromkeys(list(rot_configs.keys()) + list(trans_configs.keys())))
    bidx = {b: i for i, b in enumerate(all_names)}

    rot_data = {b: compute_rotations(cfg.get('spec', []), base_rot=cfg.get('base', [])) if isinstance(cfg, dict) else compute_rotations(cfg) for b, cfg in rot_configs.items()}
    trans_data = {b: compute_translations(spec, base=[0., HIPS_REST_Y, 0.] if b == 'hips' else None) for b, spec in trans_configs.items()}

    buf = bytearray()
    bvs, accs, samplers, channels = [], [], [], []
    time_pack = struct.pack(f'{N}f', *TIMES)

    def add_bv(data_bytes):
        off = len(buf); buf.extend(data_bytes)
        idx = len(bvs); bvs.append({"buffer":0,"byteOffset":off,"byteLength":len(data_bytes)})
        return idx

    def add_acc_time(bv_idx):
        idx = len(accs); accs.append({"bufferView":bv_idx,"componentType":5126,"count":N,"type":"SCALAR","min":[0.0],"max":[float(TIMES[-1])]})
        return idx

    def add_acc_rot(bv_idx, quats):
        idx = len(accs); accs.append({"bufferView":bv_idx,"componentType":5126,"count":N,"type":"VEC4","min":[-1.,-1.,-1.,-1.],"max":[1.,1.,1.,1.]})
        return idx

    def add_acc_trans(bv_idx, vecs):
        idx = len(accs); accs.append({"bufferView":bv_idx,"componentType":5126,"count":N,"type":"VEC3","min":[-2.,-2.,-2.],"max":[2.,2.,2.]})
        return idx

    for bone, quats in rot_data.items():
        ai_t = add_acc_time(add_bv(time_pack))
        flat = [v for q in quats for v in q]
        ai_r = add_acc_rot(add_bv(struct.pack(f'{N*4}f', *flat)), quats)
        si = len(samplers); samplers.append({"input":ai_t,"interpolation":"LINEAR","output":ai_r})
        channels.append({"sampler":si,"target":{"node":bidx[bone],"path":"rotation"}})

    for bone, vecs in trans_data.items():
        ai_t = add_acc_time(add_bv(time_pack))
        flat = [v for vec in vecs for v in vec]
        ai_p = add_acc_trans(add_bv(struct.pack(f'{N*3}f', *flat)), vecs)
        si = len(samplers); samplers.append({"input":ai_t,"interpolation":"LINEAR","output":ai_p})
        channels.append({"sampler":si,"target":{"node":bidx[bone],"path":"translation"}})

    nodes = [{"name": b, "translation": ([0.0, 0.9, 0.0] if b == "hips" else [0,0,0])} for b in all_names]
    gltf = {
        "asset":{"version":"2.0","generator":"AiDiy VRMA Gen 2.3"},
        "extensionsUsed":["VRMC_vrm_animation"],
        "extensions":{"VRMC_vrm_animation":{"specVersion":"1.0","humanoid":{"humanBones":{b:{"node":bidx[b]} for b in all_names}}}},
        "scene": 0, "scenes": [{"nodes": list(range(len(all_names)))}], "nodes": nodes,
        "animations":[{"name":anim_name,"channels":channels,"samplers":samplers}],
        "accessors":accs,"bufferViews":bvs,"buffers":[{"byteLength":len(buf)}]
    }

    jb = json.dumps(gltf,separators=(',',':'),ensure_ascii=False).encode()
    while len(jb)%4: jb += b' '
    bb = bytes(buf)
    while len(bb)%4: bb += b'\x00'
    out = bytearray()
    out += struct.pack('<III', 0x46546C67, 2, 12+8+len(jb)+8+len(bb))
    out += struct.pack('<II', len(jb), 0x4E4F534A); out += jb
    out += struct.pack('<II', len(bb), 0x004E4942); out += bb
    return bytes(out)

# ===========================================================================
# CORRECTED BASE POSE (A-pose)
# Left Upper Arm points +X, so -Z rotation moves it down to -Y.
# Right Upper Arm points -X, so +Z rotation moves it down to -Y.
# ===========================================================================
BASE_IDLE = {
    'leftUpperArm':  [('rz', -65), ('ry', -5)],   # 腕をやや前方に出して動きが見えやすく
    'rightUpperArm': [('rz',  65), ('ry',  5)],
    'leftLowerArm':  [('ry',  20)],                # 肘を自然に曲げる
    'rightLowerArm': [('ry', -20)],
}

def get_cfg(bone, spec):
    return {'base': BASE_IDLE.get(bone, []), 'spec': spec}

# ===========================================================================
# ROT_STD  — 全要素を大きめ振り付けで組み合わせた60秒総合アイドル
#
# 設計方針:
#   ① 全関節の振れ幅を大幅拡大 → キャラが「生きている」感
#   ② hips・spine の連動を強め、重心移動をはっきりさせる
#   ③ 頭・首を大きくキョロキョロ → 視線の動きが目立つ
#   ④ 腕・前腕を明確に振る → 自然で表情豊かな動き
#   ⑤ hips Y は下方向のみバウンス（'down'）→ 地面に踏ん張る、浮かない
# ===========================================================================
ROT_STD = {
    # ── 腰（重心移動の起点） ──────────────────────────────────────────────
    'hips': [
        ('rz',  8.0, P20, 0  ),   # 左右ゆらゆら（大きく）
        ('ry',  5.0, P60, Q  ),   # 超低速ドリフト
        ('ry',  2.5, P6,  H  ),   # 中速キョロ感
        ('rx',  2.0, P30, S  ),   # ゆっくり前後傾
        ('rz',  2.5, P4,  T  ),   # リズム成分
    ],
    # ── 背骨 ─────────────────────────────────────────────────────────────
    'spine': [
        ('rz',  6.0, P20, S  ),   # 横うねり（大きく）
        ('rx',  3.5, P12, Q  ),   # 前後うねり
        ('ry',  2.5, P6,  T  ),   # ねじり
        ('rz',  2.0, P4,  H  ),   # リズム連動
    ],
    # ── 首 ───────────────────────────────────────────────────────────────
    'neck': get_cfg('neck', [
        ('ry', 20.0, P20, 0  ),   # キョロキョロ（大きく）
        ('ry',  8.0, P60, H  ),   # 超低速バイアス
        ('rx',  6.0, P12, Q  ),   # うなずき
        ('rz',  3.5, P4,  S  ),   # もじもじ
        ('ry',  5.0, P6,  T  ),   # 追加キョロ
    ]),
    # ── 頭 ───────────────────────────────────────────────────────────────
    'head': get_cfg('head', [
        ('ry', 18.0, P20, S  ),   # キョロキョロ（大きく！）
        ('ry',  6.0, P60, T  ),   # 超低速バイアス
        ('rx',  6.0, P6,  0  ),   # うなずき
        ('rz',  3.5, P3,  H  ),   # もじもじ
    ]),
    # ── 左上腕 ───────────────────────────────────────────────────────────
    'leftUpperArm': get_cfg('leftUpperArm', [
        ('rx', 15.0, P20, H  ),   # ゆらゆら（大きく）
        ('rx',  6.0, P4,  T  ),   # 腕フィジェット
        ('rz',  8.0, P6,  Q  ),   # 横スウェイ（大きく）
        ('ry',  4.0, P3,  S  ),   # もじもじ
    ]),
    # ── 右上腕 ───────────────────────────────────────────────────────────
    'rightUpperArm': get_cfg('rightUpperArm', [
        ('rx', -15.0, P20, H  ),
        ('rx',  -6.0, P4,  T  ),
        ('rz',  -8.0, P6,  Q  ),
        ('ry',  -4.0, P3,  S  ),
    ]),
    # ── 左前腕 ───────────────────────────────────────────────────────────
    'leftLowerArm': get_cfg('leftLowerArm', [
        ('ry', 20.0, P3,  T  ),   # 肘もじもじ（大きく）
        ('ry', 10.0, P6,  H  ),   # ゆったり屈伸
        ('rx',  6.0, P4,  S  ),   # 捻り
    ]),
    # ── 右前腕 ───────────────────────────────────────────────────────────
    'rightLowerArm': get_cfg('rightLowerArm', [
        ('ry', -20.0, P3,  T  ),
        ('ry', -10.0, P6,  H  ),
        ('rx',  -6.0, P4,  S  ),
    ]),
    # ── 左手首 ───────────────────────────────────────────────────────────
    'leftHand': get_cfg('leftHand', [
        ('rx', 10.0, P2,  T  ),
        ('rz',  6.0, P6,  S  ),
        ('ry',  5.0, P3,  Q  ),
    ]),
    # ── 右手首 ───────────────────────────────────────────────────────────
    'rightHand': get_cfg('rightHand', [
        ('rx', -10.0, P2,  T  ),
        ('rz',  -6.0, P6,  S  ),
        ('ry',  -5.0, P3,  Q  ),
    ]),
    # ── 指（左右各7本 = 計14本） ─────────────────────────────────────────
    'leftIndexProximal':      [('rx', 12.0, P4, S )],
    'leftIndexIntermediate':  [('rx',  8.0, P3, Q )],
    'leftMiddleProximal':     [('rx', 11.0, P4, Q )],
    'leftMiddleIntermediate': [('rx',  7.0, P3, S )],
    'leftRingProximal':       [('rx',  9.0, P4, T )],
    'leftRingIntermediate':   [('rx',  6.0, P3, H )],
    'leftLittleProximal':     [('rx',  8.0, P3, H )],
    'rightIndexProximal':     [('rx', 12.0, P4, T )],
    'rightIndexIntermediate': [('rx',  8.0, P3, S )],
    'rightMiddleProximal':    [('rx', 11.0, P4, S )],
    'rightMiddleIntermediate':[('rx',  7.0, P3, Q )],
    'rightRingProximal':      [('rx',  9.0, P4, H )],
    'rightRingIntermediate':  [('rx',  6.0, P3, T )],
    'rightLittleProximal':    [('rx',  8.0, P3, E )],
}

TRANS_STD = {
    'hips': [
        ('y', 0.030, P4,  0,  'down'),  # リズムバウンス（下方向のみ → 浮かない）
        ('y', 0.015, P20, H,  'down'),  # ゆっくりしゃがみ（下方向のみ）
        ('x', 0.045, P20, 0  ),         # 左右重心移動（大きく）
        ('x', 0.018, P60, Q  ),         # 超低速ドリフト
        ('z', 0.015, P12, S  ),         # 前後揺れ
    ]
}

# ===========================================================================
# 出力: VRMA_01.vrma のみ
# ===========================================================================
if __name__ == '__main__':
    out_dir = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(out_dir, exist_ok=True)
    data = build_glb(ROT_STD, TRANS_STD, 'standard_idle')
    path = os.path.join(out_dir, 'VRMA_01.vrma')
    with open(path, 'wb') as f:
        f.write(data)
    print(f'  VRMA_01.vrma  ({len(data):,} bytes)  duration={DURATION}s  fps={FPS}  frames={N}')
    print(f'Done -> {out_dir}')
