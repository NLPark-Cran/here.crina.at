#!/usr/bin/env python3
"""立绘 v2：正常头身比 + 透明背景（seedream i2i 透明通道）"""
import base64
import json
import time
import urllib.request
from pathlib import Path

KEY = "sk-f931bd31af8d28a526c71e50001a17028111fd9d12452b44"
URL = "https://tokendance.space/gateway/ark/v3/images/generations"
ROOT = Path(__file__).parent
OUT = ROOT / "generated"
SRC = ROOT / "src_materials"


def call(body, timeout=240):
    req = urllib.request.Request(URL, data=json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {KEY}",
                                          "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())


def b64_of(path: Path) -> str:
    suffix = "jpeg" if path.suffix.lower() in (".jpg", ".jpeg") else "png"
    return f"data:image/{suffix};base64," + base64.b64encode(path.read_bytes()).decode()


def save(data: dict, path: Path) -> bool:
    item = data["data"][0]
    if item.get("b64_json"):
        raw = base64.b64decode(item["b64_json"])
    else:
        raw = urllib.request.urlopen(item["url"], timeout=120).read()
    path.write_bytes(raw)
    return True


def gen_base(name: str, prompt: str, ref: Path | None) -> Path:
    body = {"model": "seedream-5.0-pro", "prompt": prompt, "size": "2K",
            "output_format": "png", "response_format": "b64_json", "watermark": False}
    if ref:
        body["image"] = b64_of(ref)
    tmp = OUT / f"_tmp_{name}.png"
    save(call(body), tmp)
    print("base done:", name, flush=True)
    return tmp


def to_transparent(name: str, base: Path, out_name: str):
    """以立绘为唯一参考图，输出透明背景版"""
    body = {
        "model": "seedream-5.0-pro",
        "prompt": "保持图中人物完全不变（造型、配色、姿势、表情一致），仅去除背景，输出纯透明背景的全身立绘。",
        "image": b64_of(base),
        "size": "2K",
        "output_format": "png",
        "response_format": "b64_json",
        "background": "transparent",
        "watermark": False,
    }
    save(call(body), OUT / out_name)
    print("transparent done:", out_name, flush=True)


JOBS = [
    # (name, 基底prompt, 参考图)
    ("crina",
     "以参考图中的动漫少女为主体，生成正常头身比例（约七头身、身形修长自然，不要Q版大头）的全身立绘："
     "蓝紫色长卷发、异色瞳（左眼森林绿、右眼琥珀棕）、头发别着小发卡，穿米白色针织衫和浅灰长裙，"
     "手里抱着一杯桂花茶，站姿自然挺拔，温暖带一点狡黠的微笑。日系柔和插画风，纯色背景。",
     SRC / "avatar.jpg"),
    ("anfeng",
     "以参考图中的狐耳少女为主体（注意：红发带浅金色渐变发尾、异色瞳左绿右蓝、圆框眼镜、黑色X形发卡、"
     "左眼下有小三角面纹、得意吐舌坏笑），生成正常头身比例（约七头身、不要Q版大头）的全身立绘："
     "穿黑色白边襟线外套和长靴，肩上挂着观鸟望远镜，一手插兜。日系柔和插画风，纯色背景。",
     SRC / "安风自设新图.png"),
    ("xianmoying",
     "一位安静的高个子中性风少女（比身边人都高挑的清瘦女孩）：黑色中长碎发垂到下颌，深色高领毛衣"
     "外披垂坠感长风衣，耳机挂在脖子上，手里捏着一张手写乐谱，神情安静疏离但不冷漠，站姿笔直。"
     "正常头身比例（约七头身半、身形修长），深夜蓝紫色调，日系插画风，纯色背景。",
     None),
]

if __name__ == "__main__":
    for name, prompt, ref in JOBS:
        final = OUT / f"{name}_full.png"
        try:
            base = gen_base(name, prompt, ref)
            to_transparent(name, base, f"{name}_full.png")
            base.unlink(missing_ok=True)
        except Exception as e:
            print(f"❌ {name}: {e}", flush=True)
        time.sleep(2)
    print("全部完成")
