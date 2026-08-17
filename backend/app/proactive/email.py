"""邮件外发（SMTP，可选配置）"""
from __future__ import annotations

from email.message import EmailMessage

import aiosmtplib

from ..config import get_settings

settings = get_settings()


def configured() -> bool:
    return bool(settings.smtp_host and settings.smtp_user and settings.smtp_password)


async def send_mail(to: str, subject: str, text: str) -> bool:
    if not configured() or not to:
        return False
    msg = EmailMessage()
    from email.utils import formataddr
    addr = settings.smtp_from or settings.smtp_user
    msg["From"] = formataddr(("crina", addr))  # 收件箱里显示「crina」而非裸地址
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_user,
            password=settings.smtp_password,
            use_tls=settings.smtp_port == 465,
            start_tls=settings.smtp_port == 587,
            timeout=20,
        )
        return True
    except Exception:
        import logging
        logging.getLogger("crina.email").exception("邮件发送失败 to=%s", to)
        return False
