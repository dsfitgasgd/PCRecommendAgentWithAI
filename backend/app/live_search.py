import re
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx

from .config import get_settings
from .schemas import Evidence


PURCHASE_HOSTS = ("jd.com", "tmall.com", "taobao.com", "suning.com", "amazon.cn", "amazon.com")
PRICE_PATTERN = re.compile(r"(?:[¥￥]\s*|(?:售价|到手价|价格|现价)\s*[:：]?\s*)(?:\d{1,3}(?:,\d{3})+|\d{2,6})(?:\.\d{1,2})?|(?<!\d)(?:\d{1,3}(?:,\d{3})+|\d{2,6})(?:\.\d{1,2})?\s*元")
RATING_PATTERN = re.compile(r"(?<!\d)([1-5](?:\.\d)?)\s*(?:/\s*5|分|星)")


def _host(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def _is_purchase_host(host: str) -> bool:
    return any(host == domain or host.endswith("." + domain) for domain in PURCHASE_HOSTS)


def _search_query(query: str, kind: str) -> str:
    suffix = {
        "shopping": "购买 现价 京东 天猫 官方商城",
        "specs": "官方 参数 规格 配置",
        "reviews": "真实用户评价 优缺点 评测",
    }[kind]
    return f"{query} {suffix}"


def search_live(query: str, kind: str, max_results: int = 5) -> list[Evidence]:
    settings = get_settings()
    if not settings.tavily_api_key:
        raise RuntimeError("未配置 TAVILY_API_KEY，无法查询实时价格、参数和评价")
    if kind not in {"shopping", "specs", "reviews"}:
        raise ValueError("无效检索类型")
    response = httpx.post(
        "https://api.tavily.com/search",
        headers={"Authorization": f"Bearer {settings.tavily_api_key}"},
        json={"query": _search_query(query, kind), "search_depth": "basic", "max_results": max_results, "topic": "general"},
        timeout=20,
    )
    response.raise_for_status()
    observed_at = datetime.now(timezone.utc)
    sources: list[Evidence] = []
    for item in response.json().get("results", []):
        url = str(item.get("url", ""))
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            continue
        snippet = str(item.get("content", ""))[:1200]
        title = str(item.get("title", ""))[:300] or parsed.hostname
        host = _host(url)
        price_match = PRICE_PATTERN.search(f"{title} {snippet}") if kind == "shopping" else None
        rating_match = RATING_PATTERN.search(f"{title} {snippet}") if kind == "reviews" else None
        sources.append(
            Evidence(
                title=title,
                url=url,
                snippet=snippet,
                source_name=host,
                kind=kind,
                observed_at=observed_at,
                price_text=price_match.group(0).strip() if price_match else None,
                rating_text=rating_match.group(0).strip() if rating_match else None,
                is_purchase_link=kind == "shopping" and _is_purchase_host(host),
            )
        )
    return sources


def research(query: str) -> list[Evidence]:
    collected: list[Evidence] = []
    seen: set[tuple[str, str]] = set()
    for kind in ("shopping", "specs", "reviews"):
        for source in search_live(query, kind):
            key = (str(source.url), kind)
            if key not in seen:
                collected.append(source)
                seen.add(key)
    return collected
