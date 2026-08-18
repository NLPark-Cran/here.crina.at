"""R4 小屋剖面地图素材：剖面图 + 每房间氛围角图（seedream-5.0-pro）

用法：.venv/bin/python -m scripts.gen_house_map [--only section|hall|parlor|study|desk|mailbox|archive]
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import io
import logging
import sys
from pathlib import Path

import httpx
from PIL import Image

from app.config import get_settings

settings = get_settings()
log = logging.getLogger("gen_house_map")
logging.basicConfig(level=logging.INFO, format="%(message)s")

ASSETS = Path(__file__).resolve().parent.parent.parent / "assets" / "generated"
HALL_REF = ASSETS / "hall_hero.png"

STYLE = "日系温暖治愈插画风，暖米色调，柔和自然光，细腻手绘质感，吉卜力式生活气息，干净构图。"

# 房间氛围角：name -> (prompt, 是否以 hall_hero 为参考图 i2i 保连续感)
CORNERS: dict[str, tuple[str, bool]] = {
    "hall": ("温馨小屋的门厅玄关角：木质挂钩上挂着围巾和帆布包，换鞋凳上放着一本翻开的书，"
             "门口透进午后暖光，地上有一双小皮鞋。" + STYLE, True),
    "parlor": ("温馨小屋的客厅角：米色布艺沙发配针织毯，小壁炉里火光微弱，茶几上有热茶和桂花点心，"
               "地毯柔软，窗边有绿植。" + STYLE, True),
    "study": ("温馨小屋的私聊书房角：靠窗的大木桌，桌上一盏暖黄台灯、信纸与钢笔，"
              "身后是满墙书架，安静私密，月光或暖光。" + STYLE, True),
    "desk": ("温馨小屋的委托板书桌角：软木板上钉着彩色小纸条和便签，桌上摊着图纸、铅笔和一杯凉掉的茶，"
             "一盏工作台灯，有种「活儿正在施工中」的气息。" + STYLE, False),
    "mailbox": ("温馨小屋门口的木质信箱角：复古原木信箱半开着，露出几封手写信，信封上有火漆印，"
                "旁边有一小束干花和一只打盹的橘猫。" + STYLE, False),
    "archive": ("温馨小屋阁楼的档案馆角：斜顶阁楼里整齐的木抽屉柜与卷宗架，牛皮纸卷宗用麻绳捆着，"
                "灰尘在斜射的阳光里漂浮，一盏老式绿灯罩台灯。" + STYLE, False),
}

SECTION_PROMPT = (
    "一座温馨的林间小屋的「剖面图」，dollhouse 剖面视角，能看到屋内三层结构：\n"
    "- 阁楼：斜顶下的档案馆，木抽屉柜、卷宗架、一盞绿灯罩台灯；\n"
    "- 中层：温暖的客厅（米色沙发、小壁炉、茶几热茶）和安静的书房（靠窗大木桌、台灯、信纸、书架）；\n"
    "- 底层：门厅玄关（木质挂钩、换鞋凳、门口的复古木信箱）。\n"
    "房间之间有楼梯连接，每个房间都有生活气息的小细节。"
    "日系温暖治愈插画风，暖米色调，柔和光线，细腻手绘质感，横版构图，背景是简洁的浅色。"
)


def _read_ref() -> str | None:
    if not HALL_REF.exists():
        return None
    return "data:image/png;base64," + base64.b64encode(HALL_REF.read_bytes()).decode()


async def gen_image(prompt: str, ref: bool = False, size: str = "2K") -> bytes | None:
    body: dict = {
        "model": settings.image_model,
        "prompt": prompt,
        "size": size,
        "output_format": "png",
        "response_format": "b64_json",
        "watermark": False,
    }
    if ref:
        data = await asyncio.to_thread(_read_ref)
        if data:
            body["image"] = data
    async with httpx.AsyncClient(timeout=300) as client:
        resp = await client.post(
            "https://tokendance.space/gateway/ark/v3/images/generations",
            headers={"Authorization": f"Bearer {settings.tokendance_api_key}",
                     "Content-Type": "application/json"},
            json=body,
        )
        if resp.status_code != 200:
            log.error("生图失败 %s: %s", resp.status_code, resp.text[:300])
            return None
        d = resp.json()["data"][0]
        if d.get("b64_json"):
            return base64.b64decode(d["b64_json"])
        if d.get("url"):
            r = await client.get(d["url"])
            return r.content
    return None


def save_webp(raw: bytes, name: str, max_side: int = 1600) -> Path:
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    img.thumbnail((max_side, max_side), Image.LANCZOS)
    out = ASSETS / name
    img.save(out, "WEBP", quality=82)
    log.info("✓ %s (%dx%d, %.0fKB)", name, img.width, img.height, out.stat().st_size / 1024)
    return out


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="")
    args = parser.parse_args()

    if args.only in ("", "section"):
        log.info("生成小屋剖面图……")
        raw = await gen_image(SECTION_PROMPT, ref=False)
        if raw:
            save_webp(raw, "house_section.webp", max_side=2048)

    for name, (prompt, use_ref) in CORNERS.items():
        if args.only and args.only != name:
            continue
        log.info("生成氛围角：%s（%s）……", name, "i2i 保连续" if use_ref else "独立风格")
        raw = await gen_image(prompt, ref=use_ref)
        if raw:
            save_webp(raw, f"corner_{name}.webp")
        await asyncio.sleep(2)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
