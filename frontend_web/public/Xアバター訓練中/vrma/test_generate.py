# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""生成器と出力 VRMA の回帰テスト。Python 標準ライブラリだけで実行できる。"""

import json
import math
import struct
import unittest
from pathlib import Path

import generate as motion


def glb(data):
    magic, version, size = struct.unpack_from('<III', data)
    assert (magic, version, size) == (0x46546C67, 2, len(data))
    json_size, json_type = struct.unpack_from('<II', data, 12)
    assert json_type == 0x4E4F534A
    document = json.loads(data[20:20 + json_size])
    start = 20 + json_size
    binary_size, binary_type = struct.unpack_from('<II', data, start)
    assert binary_type == 0x004E4942
    binary = data[start + 8:]
    assert len(binary) == binary_size
    return document, binary


def values(document, binary, index):
    accessor = document['accessors'][index]
    view = document['bufferViews'][accessor['bufferView']]
    width = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[accessor['type']]
    offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    assert accessor['componentType'] == 5126
    unpacked = struct.unpack_from(f"<{accessor['count'] * width}f", binary, offset)
    return [unpacked[i:i + width] for i in range(0, len(unpacked), width)]


def rotate(q, point):
    p = motion.multiply(motion.multiply(q, (*point, 0)), (-q[0], -q[1], -q[2], q[3]))
    return p[:3]


def distance(a, b):
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def global_rotations(name, pose, time):
    result = {}
    for bone, (parent, _) in motion.SKELETON.items():
        q = motion.bone_rotation(bone, pose, time, name)
        result[bone] = motion.multiply(result[parent], q) if parent else q
    return result


class MotionGenerationTests(unittest.TestCase):
    def test_twenty_candidates_and_serialized_files_are_current(self):
        self.assertEqual(len(motion.POSES), 20)
        for number, (name, pose) in enumerate(motion.POSES, 1):
            with self.subTest(candidate=number):
                path = motion.ROOT / f'VRMA_{number:02d}_{name}.vrma'
                self.assertEqual(path.read_bytes(), motion.make_vrma(name, pose))

    def test_all_serialized_channels_and_rotations(self):
        rotation_count = 0
        for number, (name, pose) in enumerate(motion.POSES, 1):
            with self.subTest(candidate=number):
                document, binary = glb(motion.make_vrma(name, pose))
                self.assertEqual(document['extensions']['VRMC_vrm_animation']['specVersion'], '1.0')
                animation = document['animations'][0]
                moves_root = number in (8, 13)
                self.assertEqual(len(animation['channels']), len(motion.BONES) + int(moves_root))
                seen = set()
                for channel in animation['channels']:
                    target = channel['target']
                    seen.add((target['node'], target['path']))
                    sampler = animation['samplers'][channel['sampler']]
                    self.assertEqual(sampler['interpolation'], 'LINEAR')
                    times = [row[0] for row in values(document, binary, sampler['input'])]
                    self.assertEqual(len(times), 241)
                    self.assertEqual((times[0], times[-1]), (0.0, 8.0))
                    self.assertTrue(all(a < b for a, b in zip(times, times[1:])))
                    track = values(document, binary, sampler['output'])
                    self.assertEqual(len(track), len(times))
                    self.assertTrue(all(math.isfinite(v) for row in track for v in row))
                    self.assertLess(distance(track[0], track[-1]), 1e-6)
                    # 最後の 0.5 秒は完全に中立。終了で小さな揺れも急停止しない。
                    for row in track[-15:]:
                        self.assertLess(distance(row, track[-1]), 1e-6)
                    if target['path'] == 'rotation':
                        for q in track:
                            self.assertAlmostEqual(sum(v * v for v in q), 1, places=6)
                            rotation_count += 1
                        for a, b in zip(track, track[1:]):
                            dot = sum(x * y for x, y in zip(a, b))
                            self.assertGreater(dot, 0, 'Quaternion の符号が反転した')
                            step = math.degrees(2 * math.acos(min(1, max(-1, dot))))
                            self.assertLess(step, 5.0, '1フレームの角度変化が過大')
                self.assertEqual(seen, {(i, 'rotation') for i in range(len(motion.BONES))}
                                 | ({(0, 'translation')} if moves_root else set()))
        self.assertEqual(rotation_count, 96400)

    def test_neutral_pose_matches_page(self):
        page = (motion.ROOT.parent / 'index.html').read_text(encoding='utf-8')
        self.assertIn('leftLowerArm: [0, -10, 0], rightLowerArm: [0, 10, 0]', page)
        for name, pose in motion.POSES:
            for bone in motion.BONES:
                expected = motion.quaternion(motion.BASE.get(bone, {}))
                for time in (0, 7.5, 8):
                    self.assertLess(distance(motion.bone_rotation(bone, pose, time, name), expected), 1e-9)

    def test_elbows_bend_forward_and_never_overfold(self):
        for number, (name, pose) in enumerate(motion.POSES, 1):
            for time in motion.TIMES:
                for side, axis in [('right', (-1, 0, 0)), ('left', (1, 0, 0))]:
                    q = motion.bone_rotation(side + 'LowerArm', pose, time, name)
                    forearm = rotate(q, axis)
                    bend = math.degrees(math.acos(max(-1, min(1, sum(a*b for a, b in zip(axis, forearm))))))
                    with self.subTest(candidate=number, time=time, side=side):
                        self.assertLessEqual(bend, 150.001)
                        self.assertGreaterEqual(forearm[2], -1e-8)

    def test_bilateral_arm_mirror_preserves_long_axis(self):
        for number in (2, 5, 10):
            name, pose = motion.POSES[number - 1]
            for time in motion.TIMES:
                for suffix in ('UpperArm', 'LowerArm', 'Hand'):
                    right = motion.bone_rotation('right' + suffix, pose, time, name)
                    left = motion.bone_rotation('left' + suffix, pose, time, name)
                    expected = (right[0], -right[1], -right[2], right[3])
                    self.assertLess(distance(left, expected), 1e-9)

    def test_contact_palms_face_body_not_camera(self):
        for number, sides, threshold in [(4, ('right',), -.75), (5, ('right', 'left'), -.75),
                                          (6, ('right',), -.75), (10, ('right', 'left'), -.55)]:
            name, pose = motion.POSES[number - 1]
            for time in [2.1, 2.8, 3.5, 4.2, 5.3]:
                rotations = global_rotations(name, pose, time)
                for side in sides:
                    normal = rotate(rotations[side + 'Hand'], (0, -1, 0))
                    with self.subTest(candidate=number, time=time, side=side):
                        self.assertLess(normal[2], threshold)
        name, pose = motion.POSES[0]
        normal = rotate(global_rotations(name, pose, 3.5)['rightHand'], (0, -1, 0))
        self.assertGreater(normal[0], .7, '頬の掌は頭の中心に向ける')


    def test_upper_body_candidates_isolate_hips_and_legs(self):
        for number, (name, pose) in enumerate(motion.POSES, 1):
            for t in motion.TIMES:
                self.assertLess(distance(motion.bone_rotation('hips', pose, t, name), (0, 0, 0, 1)), 1e-9)
                if number != 8:
                    for side in (('right',) if number == 12 else ('left', 'right')):
                        for bone in ('UpperLeg', 'LowerLeg', 'Foot'):
                            self.assertLess(distance(motion.bone_rotation(side + bone, pose, t, name), (0, 0, 0, 1)), 1e-9)

    def test_named_turns_tilts_and_single_sway(self):
        # VRMA正面は+Z、本人の左は+X。カメラから見た左右と混同しない。
        for number, sign in ((9, 1), (15, 1), (14, -1)):
            name, pose = motion.POSES[number - 1]
            bone = 'chest' if number == 9 else 'head'
            forward = rotate(global_rotations(name, pose, 3.5)[bone], (0, 0, 1))
            self.assertGreater(sign * forward[0], .15)
        name, pose = motion.POSES[18]
        up = rotate(global_rotations(name, pose, 3.5)['head'], (0, 1, 0))
        self.assertGreater(up[0], .1, '左への首かしげは本人の左へ')
        name, pose = motion.POSES[2]
        tilts = [rotate(global_rotations(name, pose, t)['chest'], (0, 1, 0))[0]
                 for t in motion.TIMES if .5 < t < 6.9]
        signs = [1 if v > 1e-5 else -1 for v in tilts if abs(v) > 1e-5]
        self.assertEqual(signs[0], -1, '初めは本人の右へ')
        self.assertEqual(signs[-1], 1, '次に本人の左へ')
        self.assertEqual(sum(a != b for a, b in zip(signs, signs[1:])), 1)

    def test_slerp_antipodal_and_near_equal(self):
        q = motion.quaternion({'z': 75})
        for t in (0, .25, .5, 1):
            self.assertLess(distance(motion.slerp(q, tuple(-x for x in q), t), q), 1e-10)
            self.assertLess(distance(motion.slerp(q, q, t), q), 1e-10)


if __name__ == '__main__':
    unittest.main(verbosity=2)
