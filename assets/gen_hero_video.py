#!/usr/bin/env python3
"""门厅氛围短片：以 hall_hero 为首帧，minimax-h3 图生视频"""
import json
import time
import urllib.request
from pathlib import Path

KEY = "sk-f931bd31af8d28a526c71e50001a17028111fd9d12452b44"
BASE = "https://tokendance.space/gateway/minimax/v2"
OUT = Path(__file__).parent / "generated" / "hall_ambience.mp4"

def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())

def get(url):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {KEY}"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())

if OUT.exists():
    print("已存在，跳过")
    raise SystemExit

resp = post(f"{BASE}/video_generation", {
    "model": "minimax-h3",
    "resolution": "768P",
    "duration": 6,
    "content": [
        {"type": "text", "text": "固定镜头，温馨小屋客厅里的静谧时光：桂花茶的蒸汽缓缓上升，窗外桂花树枝叶在微风里轻轻摇晃，阳光尘埃缓慢浮动，治愈氛围，无人物"},
        {"type": "image_url", "image_url": {"url": "https://here.crina.at/assets/hall_hero.webp"}, "role": "first_frame"},
    ],
})
task_id = resp.get("task_id") or resp.get("id")
print("task:", task_id, flush=True)

for i in range(60):
    time.sleep(15)
    q = get(f"{BASE}/query/video_generation/{task_id}")
    status = (q.get("task") or {}).get("status")
    print(i, status, flush=True)
    if status == "succeeded":
        url = q["task"]["content"]["url"]
        OUT.write_bytes(urllib.request.urlopen(url, timeout=300).read())
        print("✅ 已下载", OUT)
        break
    if status in ("failed", "cancelled", "expired"):
        print("❌", json.dumps(q, ensure_ascii=False)[:300])
        break
