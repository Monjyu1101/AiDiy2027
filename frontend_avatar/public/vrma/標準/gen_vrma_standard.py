#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""
AiDiy VRMA Generator - standard idle/fidget animations
Output: frontend_avatar/public/vrma/標準/VRMA_01~05.vrma

Corrected Arm Directions (A-pose base).
Left Arm: -Z rotation to go down.
Right Arm: +Z rotation to go down.
"""

import struct, json, math, os

DURATION = 8.0
FPS = 60
N = int(FPS * DURATION) + 1
TIMES = [i / FPS for i in range(N)]

# Periods
P8 = 8.0
P4 = 4.0
P2_66 = 8.0 / 3
P2 = 2.0
P1_6 = 8.0 / 5

PI = math.pi
H  = math.pi / 2
Q  = math.pi / 4
T  = math.pi / 3
S  = math.pi / 6

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
        for axis, amp, period, phase in spec:
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
    'leftUpperArm':  [('rz', -75), ('ry', 5)],
    'rightUpperArm': [('rz', 75),  ('ry', -5)],
    'leftLowerArm':  [('ry', 10)],
    'rightLowerArm': [('ry', -10)],
}

def get_cfg(bone, spec):
    return {'base': BASE_IDLE.get(bone, []), 'spec': spec}

# --- V1: Balanced mojimoji ---
ROT_V1 = {
    'hips':  [('ry',0.8,P8,0), ('rz',0.4,P4,H)],
    'spine': [('rx',1.0,P8,Q)],
    'neck':  get_cfg('neck', [('ry',8,P8,H), ('rx',2,P4,Q)]),
    'head':  get_cfg('head', [('ry',4,P2_66,S)]),
    'leftUpperArm':  get_cfg('leftUpperArm',  [('rx',3,P8,H), ('rz',2,P4,Q)]),
    'rightUpperArm': get_cfg('rightUpperArm', [('rx',-3,P8,H), ('rz',-2,P4,Q)]),
    'leftHand':      get_cfg('leftHand',      [('rx',2,P2,T)]),
    'rightHand':     get_cfg('rightHand',     [('rx',-2,P2,T)]),
    'leftIndexProximal':  [('rx',6,P4,S)],
    'leftMiddleProximal': [('rx',5,P4,Q)],
    'rightIndexProximal': [('rx',6,P4,T)],
    'rightMiddleProximal': [('rx',5,P4,S)],
}
TRANS_V1 = {'hips': [('y',0.01,P4,H), ('x',0.005,P8,Q)]}

# --- V2: Head focus ---
ROT_V2 = {
    'hips':  [('ry',0.4,P8,Q)],
    'neck':  get_cfg('neck', [('ry',15,P8,0), ('rx',5,P4,Q)]),
    'head':  get_cfg('head', [('ry',8,P2_66,Q)]),
    'leftUpperArm':  get_cfg('leftUpperArm', [('rx',2,P8,Q)]),
    'rightUpperArm': get_cfg('rightUpperArm', [('rx',-2,P8,Q)]),
    'leftHand':      get_cfg('leftHand', [('rx',2,P2,Q)]),
    'rightHand':     get_cfg('rightHand', [('rx',-2,P2,Q)]),
}

# --- V3: Calm slow ---
ROT_V3 = {
    'hips':  [('ry',0.2,P8,S)],
    'neck':  get_cfg('neck', [('ry',5,P8,H)]),
    'leftUpperArm':  get_cfg('leftUpperArm', [('rx',1,P8,H)]),
    'rightUpperArm': get_cfg('rightUpperArm', [('rx',-1,P8,H)]),
}

# --- V4: Arm fidget ---
ROT_V4 = {
    'hips':  [('ry',1.2,P8,Q), ('rz',0.6,P4,H)],
    'leftUpperArm':  get_cfg('leftUpperArm', [('rx',6,P4,T), ('rz',4,P2_66,H)]),
    'rightUpperArm': get_cfg('rightUpperArm', [('rx',-6,P4,T), ('rz',-4,P2_66,H)]),
    'leftLowerArm':  get_cfg('leftLowerArm', [('ry',5,P2_66,T)]),
    'rightLowerArm': get_cfg('rightLowerArm', [('ry',-5,P2_66,T)]),
}

# --- V5: Light rhythm ---
ROT_V5 = {
    'hips':  [('ry',2.5,P2,0)],
    'neck':  get_cfg('neck', [('ry',6,P2,S)]),
}

VARIATIONS = [
    ('VRMA_01.vrma', ROT_V1, TRANS_V1, 'balanced_mojimoji'),
    ('VRMA_02.vrma', ROT_V2, {}, 'head_mojimoji'),
    ('VRMA_03.vrma', ROT_V3, {}, 'calm_mojimoji'),
    ('VRMA_04.vrma', ROT_V4, {}, 'arm_mojimoji'),
    ('VRMA_05.vrma', ROT_V5, {}, 'rhythm_mojimoji'),
]

if __name__ == '__main__':
    out_dir = r'D:\OneDrive\_sandbox\AiDiy2027\frontend_avatar\public\vrma\標準'
    os.makedirs(out_dir, exist_ok=True)
    for fname, rot_cfg, trans_cfg, anim_name in VARIATIONS:
        data = build_glb(rot_cfg, trans_cfg, anim_name)
        path = os.path.join(out_dir, fname)
        with open(path, 'wb') as f: f.write(data)
        print(f'  {fname}  ({len(data):,} bytes)')
    print(f'Done -> {out_dir}')
