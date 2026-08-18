"""TokenDance 网关客户端（OpenAI 兼容 + 图像/语音/视频）"""
from __future__ import annotations

import json
from collections.abc import AsyncGenerator

import httpx

from ..config import get_settings

settings = get_settings()


def _headers(api_key: str) -> dict:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "X-Site-URL": settings.site_url,
        "X-Site-Name": "Crina Space",
    }


async def chat_stream(messages: list[dict], api_key: str | None = None,
                      model: str | None = None, temperature: float = 0.9,
                      presence_penalty: float = 0.2, max_tokens: int = 2048,
                      enable_thinking: bool = False,
                      thinking_budget: int = 0,
                      reasoning_effort: str = "") -> AsyncGenerator[str, None]:
    """流式对话，逐段产出 content delta；reasoning_effort（low/medium/high/xhigh）优先于 budget"""
    key = api_key or settings.tokendance_api_key
    body = {
        "model": model or settings.chat_model,
        "messages": messages,
        "temperature": temperature,
        "presence_penalty": presence_penalty,
        "max_tokens": max_tokens,
        "stream": True,
        "enable_thinking": enable_thinking or thinking_budget > 0 or bool(reasoning_effort),
    }
    if reasoning_effort:
        body["reasoning_effort"] = reasoning_effort
    elif thinking_budget > 0:
        body["thinking_budget"] = thinking_budget
    async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=15)) as client:
        async with client.stream("POST", f"{settings.tokendance_base_url}/chat/completions",
                                 headers=_headers(key), json=body) as resp:
            if resp.status_code != 200:
                text = (await resp.aread()).decode(errors="ignore")[:300]
                raise RuntimeError(f"TokenDance {resp.status_code}: {text}")
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                    delta = chunk["choices"][0].get("delta") or {}
                    if delta.get("content"):
                        yield delta["content"]
                except Exception:
                    continue


EMBEDDING_MODEL = "qwen-text-embedding-v4"


async def embed(texts: list[str], api_key: str | None = None) -> list[list[float]]:
    """文本向量化（qwen-text-embedding-v4，1024 维）——记忆相关性召回用"""
    key = api_key or settings.tokendance_api_key
    out: list[list[float]] = []
    async with httpx.AsyncClient(timeout=60) as client:
        for i in range(0, len(texts), 10):  # 上游限制单批最多 10 条
            batch = texts[i:i + 10]
            resp = await client.post(f"{settings.tokendance_base_url}/embeddings",
                                     headers=_headers(key),
                                     json={"model": EMBEDDING_MODEL, "input": batch})
            if resp.status_code != 200:
                raise RuntimeError(f"embedding {resp.status_code}: {resp.text[:200]}")
            data = sorted(resp.json()["data"], key=lambda x: x["index"])
            out.extend(d["embedding"] for d in data)
    return out


async def chat_once(messages: list[dict], api_key: str | None = None,
                    model: str | None = None, temperature: float = 0.7,
                    max_tokens: int = 1024) -> str:
    """非流式单次对话（记忆抽取、标题生成等后台任务用）"""
    key = api_key or settings.tokendance_api_key
    body = {
        "model": model or settings.chat_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "enable_thinking": False,
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(f"{settings.tokendance_base_url}/chat/completions",
                                 headers=_headers(key), json=body)
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"] or ""


async def tts(text: str, voice_id: str = "", api_key: str | None = None) -> bytes:
    """语音合成（minimax t2a_v2）→ mp3 字节"""
    key = api_key or settings.tokendance_api_key
    body = {
        "model": settings.tts_model,
        "text": text[:1000],
        "voice_setting": {"voice_id": voice_id or "female-shaonv", "speed": 1, "vol": 1, "pitch": 0},
        "audio_setting": {"sample_rate": 32000, "bitrate": 128000, "format": "mp3", "channel": 1},
    }
    async with httpx.AsyncClient(timeout=90) as client:
        resp = await client.post("https://tokendance.space/gateway/minimax/v1/t2a_v2",
                                 headers=_headers(key), json=body)
        resp.raise_for_status()
        data = resp.json()
        base_resp = data.get("base_resp") or {}
        if base_resp.get("status_code", 0) != 0:
            raise RuntimeError(f"TTS 失败: {base_resp.get('status_msg', '')[:100]}")
        return bytes.fromhex(data["data"]["audio"])


async def gen_image(prompt: str, size: str = "1024x1024",
                    api_key: str | None = None) -> str:
    """文生图 → 图片 URL 或 b64"""
    key = api_key or settings.tokendance_api_key
    body = {"model": settings.image_model, "prompt": prompt, "size": size}
    async with httpx.AsyncClient(timeout=180) as client:
        resp = await client.post(f"{settings.tokendance_base_url}/images/generations",
                                 headers=_headers(key), json=body)
        resp.raise_for_status()
        data = resp.json()["data"][0]
        return data.get("url") or data.get("b64_json", "")
