#!/usr/bin/env python3
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""待機モーション候補を VRM Animation (GLB) として生成する。"""

import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DURATION = 8.0
FPS = 30
TIMES = [i / FPS for i in range(int(DURATION * FPS) + 1)]

# 回転角は VRM の正規化ボーンを基準とする。T ポーズの腕を自然に下げ、肘は前方に軽く曲げる。
BASE = {
    "leftUpperArm": {"z": -75},
    "rightUpperArm": {"z": 75},
    "leftLowerArm": {"y": -10},
    "rightLowerArm": {"y": 10},
}
# glTF のノードも VRMA 仕様どおり T ポーズの階層として配置する。
# 各位置は VRM_female.vrm のボーン長に近い値。回転の基準は全ノード identity。
SKELETON = {
    "hips": (None, (0, 0.9, 0)),
    "spine": ("hips", (0, 0.10, 0)),
    "chest": ("spine", (0, 0.15, 0)),
    "upperChest": ("chest", (0, 0.15, 0)),
    "neck": ("upperChest", (0, 0.14, 0)),
    "head": ("neck", (0, 0.09, 0)),
    "leftShoulder": ("upperChest", (0.06, 0.08, 0)),
    "leftUpperArm": ("leftShoulder", (0.09, 0, 0)),
    "leftLowerArm": ("leftUpperArm", (0.19, 0, 0)),
    "leftHand": ("leftLowerArm", (0.18, 0, 0)),
    "rightShoulder": ("upperChest", (-0.06, 0.08, 0)),
    "rightUpperArm": ("rightShoulder", (-0.09, 0, 0)),
    "rightLowerArm": ("rightUpperArm", (-0.19, 0, 0)),
    "rightHand": ("rightLowerArm", (-0.18, 0, 0)),
    "leftUpperLeg": ("hips", (0.09, -0.10, 0)),
    "leftLowerLeg": ("leftUpperLeg", (0, -0.38, 0)),
    "leftFoot": ("leftLowerLeg", (0, -0.36, 0.05)),
    "rightUpperLeg": ("hips", (-0.09, -0.10, 0)),
    "rightLowerLeg": ("rightUpperLeg", (0, -0.38, 0)),
    "rightFoot": ("rightLowerLeg", (0, -0.36, 0.05)),
}
BONES = tuple(SKELETON)

# 00 は既存の「標準/VRMA_01.vrma」をそのままコピーする。
# 1〜20 は穏やかな待機動作の候補。腕の左右は VRM の左右に従う。
POSES = [
    ("右手を頬に添える", {"head": {"z": -4}}),
    ("後ろ手で少し前かがみ", {"spine": {"x": 8}, "chest": {"x": 5}, "neck": {"x": -8}, "head": {"x": -5, "z": 4}}),
    ("左右にゆっくり揺れる", {}),
    ("右手を胸に当てる", {}),
    ("両手を胸の前へ", {}),
    ("右手を顎の近くへ", {"head": {"x": 4}}),
    ("目が合って照れてそらす", {"spine": {"y": 4, "x": 3}, "neck": {"y": 8, "x": 6}, "head": {"y": 13, "x": 10, "z": 5}}),
    ("ひざをそろえて軽くかがむ", {"spine": {"x": 4}, "neck": {"x": -4}, "head": {"x": -5}, "leftUpperLeg": {"x": -20}, "rightUpperLeg": {"x": -20}, "leftLowerLeg": {"x": 40}, "rightLowerLeg": {"x": 40}, "leftFoot": {"x": -20}, "rightFoot": {"x": -20}}),
    ("左向きから画面をのぞき込む", {"spine": {"x": 28, "y": 20}, "chest": {"x": 17, "y": 15}, "upperChest": {"x": 9}, "neck": {"x": -30, "y": -18}, "head": {"x": -31, "y": -17}}),
    ("両手をお腹の前へ", {}),
    ("背筋を少し伸ばす", {"spine": {"x": -4}, "chest": {"x": -4}, "head": {"x": -2}}),
    ("片足を内側に寄せる", {}),
    ("左に重心を寄せる", {"spine": {"z": -3}, "head": {"z": -2}}),
    ("右に視線を向ける", {"neck": {"y": -9}, "head": {"y": -10}}),
    ("左肩越しに振り返る", {"spine": {"y": 20}, "chest": {"y": 15}, "neck": {"y": 9}, "head": {"y": 8, "z": 4}}),
    ("少しうつむく", {"neck": {"x": 5}, "head": {"x": 8}, "spine": {"x": 2}}),
    ("少し上を見る", {"neck": {"x": -5}, "head": {"x": -8}, "chest": {"x": -2}}),
    ("小さく一回うなずく", {}),
    ("左に首をかしげる", {"neck": {"z": -6}, "head": {"z": -10}, "chest": {"z": 2}}),
    ("小さくおじぎする", {"spine": {"x": 7}, "chest": {"x": 5}, "neck": {"x": -2}, "head": {"x": 6}}),
]


# 右腕を基準に、肩の Z→Y→X、肘の屈曲 Y、前腕の回内外 X を分離する。
# 旧 XYZ 一括合成では肘が 185〜190°まで逆折れし、掌も外を向いていた。
# 数値は (肩下げ, 肩前出し, 上腕ひねり, 肘屈曲, 前腕ひねり)。
# 左腕は X 平面鏡映 (qx, -qy, -qz, qw) で作り、X 回転を反転しない。
# 胸・顎へ寄せる04/05/06は、大きな袖口が胴体へ深くめり込まない余裕も確保する。
ARM_POSES = {
    "右手を頬に添える": {"right": (48.20, 14.39, -21.96, 140.22, -57.89)},
    "後ろ手で少し前かがみ": {
        "right": (57.238, -36.508, 70.805, 61.601, -62.894),
        "left": (57.238, -36.508, 70.805, 61.601, -62.894),
    },
    "右手を胸に当てる": {"right": (33.13, 22.10, 13.49, 130.16, -61.05)},
    "両手を胸の前へ": {
        "right": (33.13, 22.10, 13.49, 130.16, -61.05),
        "left": (33.13, 22.10, 13.49, 130.16, -61.05),
    },
    "右手を顎の近くへ": {"right": (51.90, 27.81, 4.24, 133.48, -75.34)},
    "両手をお腹の前へ": {
        "right": (49.15, 5.26, 39.89, 100.25, -19.50),
        "left": (49.15, 5.26, 39.89, 100.25, -19.50),
    },
}


def multiply(a, b):
    x, y, z, w = a
    X, Y, Z, W = b
    return (w*X + x*W + y*Z - z*Y,
            w*Y - x*Z + y*W + z*X,
            w*Z + x*Y - y*X + z*W,
            w*W - x*X - y*Y - z*Z)


def quaternion(angles):
    result = (0.0, 0.0, 0.0, 1.0)
    for axis in ("x", "y", "z"):
        angle = math.radians(angles.get(axis, 0)) / 2
        s, c = math.sin(angle), math.cos(angle)
        rotation = {"x": (s, 0, 0, c), "y": (0, s, 0, c), "z": (0, 0, s, c)}[axis]
        result = multiply(result, rotation)
    length = math.sqrt(sum(v*v for v in result))
    return tuple(v/length for v in result)


def smoothstep(value):
    x = max(0.0, min(1.0, value))
    return x * x * (3 - 2 * x)


def gesture_weight(t):
    """中立 → ポーズ → 中立。両端は同じ姿勢なのでループで跳ねない。"""
    return smoothstep((t - 0.25) / 1.8) * (1 - smoothstep((t - 5.4) / 1.8))


def bone_angles(bone, pose, t, name):
    base = BASE.get(bone, {})
    goal = pose.get(bone, {})
    is_lean = "画面をのぞき込む" in name
    turn = smoothstep((t - 0.2) / 1.2) * (1 - smoothstep((t - 6.1) / 1.3))
    bend = smoothstep((t - 1.1) / 1.7) * (1 - smoothstep((t - 5.1) / 1.6))
    gaze = smoothstep((t - 1.6) / 1.2) * (1 - smoothstep((t - 4.9) / 1.8))
    def weight_for(axis):
        if name == "目が合って照れてそらす" and bone in ("neck", "head"):
            return smoothstep((t - 1.5) / 1.0) * (1 - smoothstep((t - 5.1) / 1.4))
        if not is_lean:
            return gesture_weight(t)
        if bone in ("neck", "head"):
            # 前傾を強めても顔が下を向かないよう、縦の補正だけ胴体と同期する。
            return bend if axis == "x" else gaze
        if bone in ("spine", "chest") and axis == "y":
            return turn
        return bend
    angles = {axis: base.get(axis, 0) + (goal.get(axis, base.get(axis, 0)) - base.get(axis, 0)) * weight_for(axis)
              for axis in ("x", "y", "z")}
    if is_lean and bone in ("leftUpperArm", "rightUpperArm"):
        # 深い前傾に腕が引かれて後ろへ浮かないよう、肩から自然に下ろす。
        angles["x"] -= 38 * bend
    if name == "左右にゆっくり揺れる":
        # 腰を回すと脚まで揺れ、逆向きの背骨回転で上体の揺れが消える。
        # 背骨・胸だけで右→左へ一往復し、骨盤と両脚は中立を保つ。
        sway = math.sin(2 * math.pi * (t - 0.25) / 7.0) * gesture_weight(t)
        if bone == "spine":
            angles["z"] += 6 * sway
        elif bone == "chest":
            angles["z"] += 3 * sway
        elif bone == "head":
            angles["z"] -= 2 * sway
        elif bone == "leftUpperArm":
            angles["z"] -= 2 * sway
        elif bone == "rightUpperArm":
            angles["z"] += 2 * sway
    elif name == "片足を内側に寄せる":
        # 足踏みを繰り返さず、左足を一度だけ内側へ寄せて戻す。
        tap = smoothstep((t - 1.0) / 1.2) * (1 - smoothstep((t - 4.7) / 1.5))
        if bone == "leftUpperLeg":
            angles["x"] -= 7 * tap
            angles["z"] -= 6 * tap
        elif bone == "leftLowerLeg":
            angles["x"] += 10 * tap
            angles["z"] += 2 * tap
        elif bone == "leftFoot":
            angles["x"] -= 3 * tap
            angles["z"] += 4 * tap
    elif name == "小さく一回うなずく":
        nod = smoothstep((t - 1.5) / 0.55) * (1 - smoothstep((t - 2.6) / 0.65))
        if bone == "chest":
            angles["x"] += 1.5 * nod
        elif bone == "neck":
            angles["x"] += 4 * nod
        elif bone == "head":
            angles["x"] += 8 * nod
    # 前腕と手首も動かす。ポーズ保持中の動きは小さく、入口・出口は中立へ戻す。
    breathing = math.sin(2 * math.pi * t / DURATION) * gesture_weight(t)
    fidget = math.sin(4 * math.pi * t / DURATION) * gesture_weight(t)
    if bone in ("spine", "chest"):
        angles["x"] += breathing * 1.2
    elif bone in ("neck", "head"):
        angles["y"] += fidget * 1.5
    elif bone in ("leftUpperArm", "rightUpperArm"):
        angles["x"] += breathing * 2.5
    elif bone in ("leftLowerArm", "rightLowerArm"):
        angles["y"] += fidget * (-1 if bone.startswith("left") else 1)
    elif bone in ("leftHand", "rightHand"):
        angles["z"] += breathing * (1.5 if bone.startswith("left") else -1.5)
    return angles


def slerp(a, b, weight):
    """最短弧の球面補間。肩の回転を Euler 角の枝切りで跳ねさせない。"""
    dot = sum(x * y for x, y in zip(a, b))
    if dot < 0:
        b = tuple(-v for v in b)
        dot = -dot
    dot = min(1.0, max(-1.0, dot))
    if dot > 0.9995:
        result = tuple(x + (y - x) * weight for x, y in zip(a, b))
    else:
        theta = math.acos(dot)
        result = tuple((math.sin((1 - weight) * theta) * x
                        + math.sin(weight * theta) * y) / math.sin(theta)
                       for x, y in zip(a, b))
    length = math.sqrt(sum(v * v for v in result))
    return tuple(v / length for v in result)


def bone_rotation(bone, pose, t, name):
    """腕は肘の屈曲と前腕のひねりを別々に補間し、150°以内に保つ。"""
    side = "right" if bone.startswith("right") else "left"
    target = ARM_POSES.get(name, {}).get(side)
    if not target or bone not in (side + "UpperArm", side + "LowerArm"):
        return quaternion(bone_angles(bone, pose, t, name))
    drop, forward, twist, bend, roll = target
    if not 0 <= bend <= 150:
        raise ValueError(f"肘の屈曲範囲外: {name}: {bend}")
    weight = gesture_weight(t)
    clearance = 4 * weight * (1 - weight) if name == "後ろ手で少し前かがみ" else 0
    if bone.endswith("UpperArm"):
        goal = multiply(multiply(quaternion({"z": drop}), quaternion({"y": forward})),
                        quaternion({"x": twist}))
        result = slerp(quaternion({"z": 75}), goal, weight)
        # 袖口を腰の外側へ回す。左右対称、始点・終点で追加回転は厳密にゼロ。
        if clearance:
            arc = multiply(multiply(quaternion({"z": -13.552 * clearance}),
                                    quaternion({"y": 23.446 * clearance})),
                           quaternion({"x": 7.355 * clearance}))
            result = multiply(arc, result)
    else:
        # X は腕の長軸。肘を折る Y の後に回内外だけを合成する。
        result = multiply(quaternion({"y": 10 + (bend - 10) * weight + 16.632 * clearance}),
                          quaternion({"x": roll * weight - 31.184 * clearance}))
    if side == "left":
        x, y, z, w = result
        result = (x, -y, -z, w)
    return result


def make_vrma(name, pose):
    # 全候補で同じボーンを出力し、ページを戻したとき前の姿勢が残らないようにする。
    binary = bytearray()
    views, accessors, samplers, channels = [], [], [], []
    node_index = {bone: index for index, bone in enumerate(BONES)}
    nodes = [{"name": bone, "translation": list(SKELETON[bone][1])} for bone in BONES]
    for bone, (parent, _) in SKELETON.items():
        if parent:
            nodes[node_index[parent]].setdefault("children", []).append(node_index[bone])

    def accessor(values, width, minimum=None, maximum=None):
        offset = len(binary)
        binary.extend(struct.pack(f"<{len(values)}f", *values))
        view = len(views)
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(values)*4})
        result = len(accessors)
        entry = {"bufferView": view, "componentType": 5126, "count": len(values)//width,
                 "type": {1: "SCALAR", 3: "VEC3", 4: "VEC4"}[width]}
        if minimum is not None:
            entry["min"], entry["max"] = minimum, maximum
        accessors.append(entry)
        return result

    time_accessor = accessor(TIMES, 1, [0.0], [DURATION])
    for node, bone in enumerate(BONES):
        values = []
        for t in TIMES:
            values.extend(bone_rotation(bone, pose, t, name))
        output = accessor(values, 4)
        sampler = len(samplers)
        samplers.append({"input": time_accessor, "output": output, "interpolation": "LINEAR"})
        channels.append({"sampler": sampler, "target": {"node": node, "path": "rotation"}})

    # 静止する腰はトラックを省略し、対象VRMの固有の中立位置を維持する。
    if name in ("ひざをそろえて軽くかがむ", "左に重心を寄せる"):
        hips_values = []
        for t in TIMES:
            weight = gesture_weight(t)
            side = -1 if name == "右に重心を寄せる" else (1 if name == "左に重心を寄せる" else 0)
            # 呼吸は胸だけで表現する。腰の上下移動は全身（足を含む）を浮かせる。
            # 前かがみ・振り返りも上体で行い、足を動かす必要のある08/13だけ骨盤を移動。
            hips_values.extend((side * 0.045 * weight,
                                0.9 - (0.045 * weight if name == "ひざをそろえて軽くかがむ" else 0),
                                0.0))
        hips_output = accessor(hips_values, 3)
        hips_sampler = len(samplers)
        samplers.append({"input": time_accessor, "output": hips_output, "interpolation": "LINEAR"})
        channels.append({"sampler": hips_sampler, "target": {"node": node_index["hips"], "path": "translation"}})

    gltf = {
        "asset": {"version": "2.0", "generator": "AiDiy idle motion candidates"},
        "extensionsUsed": ["VRMC_vrm_animation"],
        "extensions": {"VRMC_vrm_animation": {"specVersion": "1.0", "humanoid": {
            "humanBones": {bone: {"node": index} for index, bone in enumerate(BONES)}
        }}},
        "scene": 0, "scenes": [{"nodes": [node_index["hips"]]}], "nodes": nodes,
        "animations": [{"name": name, "channels": channels, "samplers": samplers}],
        "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(binary)}],
    }
    json_chunk = json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    json_chunk += b" " * (-len(json_chunk) % 4)
    binary.extend(b"\x00" * (-len(binary) % 4))
    length = 12 + 8 + len(json_chunk) + 8 + len(binary)
    return (struct.pack("<III", 0x46546C67, 2, length)
            + struct.pack("<II", len(json_chunk), 0x4E4F534A) + json_chunk
            + struct.pack("<II", len(binary), 0x004E4942) + binary)


if __name__ == "__main__":
    for number, (name, pose) in enumerate(POSES, 1):
        path = ROOT / f"VRMA_{number:02d}_{name}.vrma"
        path.write_bytes(make_vrma(name, pose))
        print(f"{path.name}: {name}")
