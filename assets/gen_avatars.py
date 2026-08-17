#!/usr/bin/env python3
"""批量生成空间居民立绘（seedream-5.0-pro，支持参考图）"""
import base64
import json
import time
import urllib.request
from pathlib import Path

KEY = "sk-f931bd31af8d28a526c71e50001a17028111fd9d12452b44"
URL = "https://tokendance.space/gateway/ark/v3/images/generations"
ROOT = Path(__file__).parent
OUT = ROOT / "generated"
OUT.mkdir(exist_ok=True)

ANIME = "日系柔和插画风，线条干净，色彩温暖，高质量，浅色纯色背景，全身立绘。"

TASKS = [
    {
        "file": "anfeng_full.png",
        "ref": "src_materials/安风自设.jpg",
        "prompt": "以参考图中的狐耳少女为主体，生成她的全身立绘：红色短发、狐耳、圆框眼镜、绿色眼睛、黑色X形发卡，穿深色外套和长靴，肩上挂着观鸟望远镜，另一只手随意插在口袋里，表情带着一点得意的坏笑。" + ANIME,
    },
    {
        "file": "guagua.png",
        "ref": "/tmp/guancha_ref/watcha品牌IP基础形象+两个动作延展@2x.png",
        "prompt": "参考图中左侧第一只穿绿T恤的白色小兽（猹），生成同款简笔画线条风格的单独立绘：圆滚滚的白色小猹，穿着绿色T恤，两只爪子抱着一牙红西瓜，开心眯眼笑，纯白背景，贴纸感，粗描边。",
    },
    {
        "file": "qiulening_full.png",
        "prompt": "一位温婉的邻家姐姐：栗色长直发别着桂花枝，浅驼色针织开衫配米色长裙，双手捧着一封信和几本旧书，眼神温柔安静，像秋天的下午。" + ANIME,
    },
    {
        "file": "xianmoying_full.png",
        "prompt": "一位冷峻的年轻音乐人：黑色中长碎发，深色高领毛衣外披长款深色风衣，耳机挂在脖子上，手里捏着一张手写乐谱，神情淡淡的，深夜蓝紫色调。" + ANIME,
    },
    {
        "file": "tuanxiaoman_full.png",
        "prompt": "一位元气满满的少女：双丸子头配草莓发饰，粉色卫衣外罩白色小围裙，高高举着一块草莓奶油蛋糕，笑容灿烂眼睛弯成月牙，活泼跳跃的站姿。" + ANIME,
    },
    {
        "file": "baixu_full.png",
        "prompt": "一位知性清隽的少年：浅青灰短发，细框眼镜，白色衬衫配深色马甲，怀里抱着一摞系着细绳的档案卷宗，指间夹着一支羽毛笔，神情认真温雅，老派书生气质。" + ANIME,
    },
    {
        "file": "hall_hero.png",
        "prompt": "温馨的小屋客厅全景：木质书架上摆着旧书和观鸟望远镜，圆桌上有一壶冒着热气的桂花茶和信件，落地窗外是洒满晨光的桂花树，沙发上有针织毯，吉卜力式温暖治愈插画，柔和晨光，无人，宽幅构图。",
        "size": "2K",
    },
]


def gen(task: dict) -> bool:
    body = {
        "model": "seedream-5.0-pro",
        "prompt": task["prompt"],
        "size": task.get("size", "2K"),
        "output_format": "png",
        "response_format": "url",
        "watermark": False,
    }
    ref = task.get("ref")
    if ref:
        ref_path = Path(ref) if ref.startswith("/") else ROOT / ref
        b64 = base64.b64encode(ref_path.read_bytes()).decode()
        suffix = "jpeg" if ref_path.suffix.lower() in (".jpg", ".jpeg") else "png"
        body["image"] = f"data:image/{suffix};base64,{b64}"
    req = urllib.request.Request(
        URL, data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=240) as resp:
            data = json.loads(resp.read())
        img_url = data["data"][0]["url"]
        with urllib.request.urlopen(img_url, timeout=120) as resp:
            (OUT / task["file"]).write_bytes(resp.read())
        print(f"✅ {task['file']}", flush=True)
        return True
    except Exception as e:
        print(f"❌ {task['file']}: {e}", flush=True)
        return False


if __name__ == "__main__":
    for task in TASKS:
        if (OUT / task["file"]).exists():
            print(f"⏭ {task['file']} 已存在")
            continue
        gen(task)
        time.sleep(2)
    print("全部完成")
