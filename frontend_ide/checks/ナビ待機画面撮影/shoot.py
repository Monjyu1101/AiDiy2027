"""ナビ待機画面を1種ずつ単体表示し、表示完了から指定秒後に aidiy_windows_control のHTTPで撮影する（Windows専用）。
前提: Tools(8095)起動済み、build.mjs実行済み。
使い方: python shoot.py <待ち秒> <画面名...>   例: python shoot.py 15 ride clock / python shoot.py 45 fireworks nightflight
画面名: ride fireworks aquarium kaleidoscope water clock maze request nightflight
出力: temp/ナビ待機画面撮影/shots/<画面名>.png（800×600）
"""
import json, os, subprocess, sys, time, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ELECTRON = os.path.join(REPO, "backend_diag", "node_modules", "electron", "dist", "electron.exe")
WORK = os.path.join(REPO, "temp", "ナビ待機画面撮影")
OUT = os.path.join(WORK, "shots")
os.makedirs(OUT, exist_ok=True)

def post(path, **kw):
    req = urllib.request.Request("http://127.0.0.1:8095/" + path,
        data=json.dumps(kw, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))

wait = float(sys.argv[1])
for scene in sys.argv[2:]:
    marker = os.path.join(WORK, "marker.txt")
    if os.path.exists(marker): os.remove(marker)
    p = subprocess.Popen([ELECTRON, os.path.join(HERE, "show.cjs"), f"--scene={scene}", f"--marker={marker}"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    t0 = time.time()
    while not os.path.exists(marker) and time.time() - t0 < 30: time.sleep(0.2)
    loaded = time.time()
    time.sleep(max(0, wait - (time.time() - loaded)))
    path = os.path.join(OUT, f"{scene}.png")
    post("aidiy_desktop_capture/screenshot", window_title="SceneShot", save_path=path.replace("\\", "/"))
    print(scene, "表示完了から %.1f 秒後に撮影" % (time.time() - loaded), os.path.exists(path), flush=True)
    subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
