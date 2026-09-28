#!/usr/bin/env python3
"""글로벌·국내 신발/스포츠 산업뉴스를 실제 출처 사이트에서 직접 수집해
data/industry-news.json에 반영한다.

이전 버전(claude.ai 예약 루틴, trig_01GdSPEYSSuDRX9vkoYC617t)은 실행 샌드박스의
네트워크 egress 정책이 WebFetch를 막아 원문을 직접 열 수 없었고, 그 결과 WebSearch
교차검증에만 의존해 항상 며칠~1주일 지난 기사만 확인할 수 있었다(신선도 문제).

이 스크립트는 GitHub Actions(무신사 크롤러와 동일하게 egress 제한 없음)에서 돌아
각 출처의 RSS 또는 실제 기사 페이지를 직접 열어 진짜 발행일을 확보한다. AI는 오직
"수집된 후보 중 무엇을 선택·분류·번역·요약할지"만 판단하는 단발성 배치 호출
한 번으로 제한된다(리서치/검증이 아니라 편집 판단만 수행).

사용법:
  python scripts/crawl_industry_news.py            # 실제로 fetch + AI 분류 + 파일 갱신
  python scripts/crawl_industry_news.py --dry-run  # fetch(+ API 키 있으면 분류)만 하고 파일은 건드리지 않음

데이터 파일 커밋/푸시는 이 스크립트가 하지 않는다(무신사 크롤러와 동일한 관례) —
.github/workflows/industry-news-crawl.yml의 별도 스텝이 변경 여부를 보고 커밋한다.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import feedparser
import requests
from bs4 import BeautifulSoup

if hasattr(sys.stdout, "reconfigure"):
    # Windows 콘솔(cp949)에서 로컬 --dry-run 테스트 시 한글/특수문자 print가 깨지는 것 방지.
    # GitHub Actions(Linux, UTF-8)에서는 영향 없음.
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
KST = timezone(timedelta(hours=9))
UTC = timezone.utc

LOOKBACK_DAYS = 10          # 후보 수집 시 이 기간 이내 발행 기사만 본다
WINDOW_DAYS = 28            # data/industry-news.json의 보관 기간(정책 문서와 동일)
DOMESTIC_TARGET = 10        # 정책 문서의 domesticTarget과 동일
REQUEST_TIMEOUT = 10
MAX_ARTICLE_FETCHES_PER_SOURCE = 25  # 사이트별 개별 기사 페이지 요청 상한(예의상 제한)

HEADERS = {
    # 브라우저를 사칭하지 않는 정직한 UA. just-style.com 등 일부 WAF는 오히려
    # "브라우저인 척하지만 TLS/헤더가 브라우저가 아닌" 요청을 차단하고, 이렇게
    # 정체를 밝힌 요청은 통과시키는 것을 실제 테스트로 확인했다(2026-09-28).
    "User-Agent": "KLAB-NewsBot/1.0 (+internal research tool; contact leejh77@k2korea.co.kr)",
}

VALID_CATEGORIES = {
    "신모델", "신규브랜드", "글로벌비즈니스", "국내비즈니스",
    "신소재", "생산기술", "유행아이템", "거시트렌드", "미시트렌드",
}


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


def read_json(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    return json.loads(text.lstrip("﻿"))


def get(url: str, **kwargs) -> requests.Response:
    kwargs.setdefault("headers", HEADERS)
    kwargs.setdefault("timeout", REQUEST_TIMEOUT)
    try:
        return requests.get(url, **kwargs)
    except requests.exceptions.RequestException:
        # 일회성 타임아웃/네트워크 hiccup 대비 1회만 재시도(사이트가 진짜 죽은 경우는 이것도 실패해 위로 전파됨).
        return requests.get(url, **kwargs)


def normalize_url(url: str) -> str:
    try:
        u = urlparse(url)
        return f"{u.scheme}://{u.netloc}{u.path}".rstrip("/")
    except Exception:
        return url


def strip_html(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html or "").strip()


# ---------------------------------------------------------------------------
# Generic helpers reused across several site-specific scrapers
# ---------------------------------------------------------------------------

def ldjson_date(soup: BeautifulSoup) -> str | None:
    """schema.org NewsArticle datePublished, if present (apparelnews.co.kr, itnk.co.kr 등)."""
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except Exception:
            continue
        candidates = data if isinstance(data, list) else [data]
        for d in candidates:
            if isinstance(d, dict) and d.get("datePublished"):
                return d["datePublished"]
    return None


def meta_date(soup: BeautifulSoup, *names: str) -> str | None:
    for m in soup.find_all("meta"):
        prop = m.get("property") or m.get("name")
        if prop in names and m.get("content"):
            return m["content"]
    return None


def parse_iso_to_kst_date(value: str) -> str | None:
    """다양한 ISO 8601 변형(밀리초, 'Z', 시간대 없음 등)을 KST 기준 YYYY-MM-DD로 정규화.
    RFC 822(RSS 표준)는 feedparser가 이미 처리하므로 여기까지 오는 일은 드물다."""
    if not value:
        return None
    value = value.strip()
    v = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        dt = datetime.fromisoformat(v)  # 3.11+: 밀리초·초 생략 등 대부분의 변형을 관대하게 처리
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=KST)  # 시간대 없으면 KST로 간주(대부분 국내 출처)
        return dt.astimezone(KST).strftime("%Y-%m-%d")
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=KST).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def within_lookback(date_str: str, now_kst: datetime) -> bool:
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=KST)
    except ValueError:
        return False
    return timedelta(0) <= (now_kst - d) <= timedelta(days=LOOKBACK_DAYS + 1)


# ---------------------------------------------------------------------------
# RSS-based fetchers (real pubDate straight from the feed, no extra fetch needed)
# ---------------------------------------------------------------------------

def fetch_rss(domain: str, feed_url: str, now_kst: datetime) -> list[dict]:
    out = []
    try:
        r = get(feed_url)
        r.raise_for_status()
    except Exception as ex:
        log(f"[{domain}] RSS fetch failed ({feed_url}): {ex}")
        return out
    feed = feedparser.parse(r.content)
    if feed.bozo and not feed.entries:
        log(f"[{domain}] RSS parse produced 0 entries ({feed_url}): {feed.bozo_exception}")
        return out
    for e in feed.entries:
        link, title = e.get("link"), e.get("title")
        if not link or not title:
            continue
        date_str = None
        if e.get("published_parsed"):
            date_str = datetime(*e.published_parsed[:6], tzinfo=UTC).astimezone(KST).strftime("%Y-%m-%d")
        elif e.get("updated_parsed"):
            date_str = datetime(*e.updated_parsed[:6], tzinfo=UTC).astimezone(KST).strftime("%Y-%m-%d")
        if not date_str or not within_lookback(date_str, now_kst):
            continue
        out.append({
            "title": title.strip(),
            "url": link.strip(),
            "date": date_str,
            "snippet": strip_html(e.get("summary", ""))[:300],
            "source_domain": domain,
        })
    return out


RSS_SOURCES = {
    # domain -> feed URL (모두 2026-09-28 실제 fetch로 확인됨)
    "footwearbiz.com": "https://footwearbiz.com/rss.xml",
    "shoespost.jp": "https://shoespost.jp/feed/",
    "sgbonline.com": "https://sgbonline.com/feed/",
    "hypebeast.com": "https://hypebeast.com/feed",
    "just-style.com": "https://www.just-style.com/feed/",
    "tnnews.co.kr": "https://tnnews.co.kr/feed",
    "ktnews.com": "https://www.ktnews.com/rss/allArticle.xml",
    "itnk.co.kr": "https://www.itnk.co.kr/rss/allArticle.xml",
    "okfashion.co.kr": "https://okfashion.co.kr/happynews_rss.php",
}


# ---------------------------------------------------------------------------
# Site-specific HTML scrapers (no RSS available)
# ---------------------------------------------------------------------------

def fetch_sportstextiles(now_kst: datetime) -> list[dict]:
    """리스트: /News (앵커 href=/News/{id}, 텍스트=제목). 기사 페이지: <div class="date">DD/MM/YYYY</div>."""
    domain = "sportstextiles.com"
    out = []
    try:
        r = get("https://sportstextiles.com/News")
        r.raise_for_status()
    except Exception as ex:
        log(f"[{domain}] listing fetch failed: {ex}")
        return out
    soup = BeautifulSoup(r.text, "html.parser")
    seen = set()
    items = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if re.fullmatch(r"/News/\d+", href) and href not in seen:
            text = a.get_text(strip=True)
            if text and len(text) > 5:
                seen.add(href)
                items.append((href, text))
    for href, title in items[:MAX_ARTICLE_FETCHES_PER_SOURCE]:
        url = urljoin("https://sportstextiles.com", href)
        try:
            ar = get(url)
            ar.raise_for_status()
        except Exception as ex:
            log(f"[{domain}] article fetch failed ({url}): {ex}")
            continue
        asoup = BeautifulSoup(ar.text, "html.parser")
        date_div = asoup.find("div", class_="date")
        if not date_div:
            continue
        m = re.match(r"(\d{2})/(\d{2})/(\d{4})", date_div.get_text(strip=True))
        if not m:
            continue
        date_str = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
        if not within_lookback(date_str, now_kst):
            continue
        para = asoup.find("p")
        out.append({
            "title": title,
            "url": url,
            "date": date_str,
            "snippet": (para.get_text(strip=True)[:300] if para else ""),
            "source_domain": domain,
        })
    return out


def fetch_highsnobiety(now_kst: datetime) -> list[dict]:
    """리스트 페이지 자체에 <time datetime=ISO data-cy="teaser-date"> 가 있어 추가 fetch 불필요."""
    domain = "highsnobiety.com"
    out = []
    try:
        r = get("https://www.highsnobiety.com/tag/sneakers/")
        r.raise_for_status()
    except Exception as ex:
        log(f"[{domain}] listing fetch failed: {ex}")
        return out
    soup = BeautifulSoup(r.text, "html.parser")
    for t in soup.find_all("time", attrs={"data-cy": "teaser-date"}):
        iso = t.get("datetime")
        date_str = parse_iso_to_kst_date(iso) if iso else None
        if not date_str or not within_lookback(date_str, now_kst):
            continue
        link, title = None, None
        node = t
        for _ in range(6):
            node = node.parent
            if node is None:
                break
            a = node.find("a", href=re.compile(r"^/p/"))
            if a and not link:
                link = urljoin("https://www.highsnobiety.com", a["href"])
            h = node.find(["h2", "h3", "h4"])
            if h and not title:
                title = h.get_text(strip=True)
            if link and title:
                break
        if link and title:
            out.append({"title": title, "url": link, "date": date_str, "snippet": "", "source_domain": domain})
    return out


def fetch_fi_co_kr(now_kst: datetime) -> list[dict]:
    """리스트(EUC-KR): /main/view.asp?idx=N. 기사: meta og:start_time = 발행일 대용."""
    domain = "fi.co.kr"
    out = []
    try:
        r = get("https://www.fi.co.kr/")
        r.encoding = "euc-kr"
        r.raise_for_status()
    except Exception as ex:
        log(f"[{domain}] listing fetch failed: {ex}")
        return out
    soup = BeautifulSoup(r.text, "html.parser")
    seen_idx, items = set(), []
    for a in soup.find_all("a", href=True):
        m = re.search(r"view\.asp\?idx=(\d+)", a["href"])
        if not m:
            continue
        idx = m.group(1)
        if idx in seen_idx:
            continue
        # <a class="inbox"> 내부는 <h3>제목</h3><p>부제</p> 구조 — h3만 취하면 깨끗한 제목을 얻는다.
        # (h3가 없는 다른 종류의 앵커는 title+subtitle이 공백 없이 이어붙어 나올 수 있어 건너뛴다.)
        h3 = a.find("h3")
        text = h3.get_text(strip=True) if h3 else None
        if not text:
            continue
        seen_idx.add(idx)
        items.append((idx, text[:120]))
    for idx, title in items[:MAX_ARTICLE_FETCHES_PER_SOURCE]:
        url = f"https://www.fi.co.kr/main/view.asp?idx={idx}"
        try:
            ar = get(url)
            ar.encoding = "euc-kr"
            ar.raise_for_status()
        except Exception as ex:
            log(f"[{domain}] article fetch failed ({url}): {ex}")
            continue
        asoup = BeautifulSoup(ar.text, "html.parser")
        raw = meta_date(asoup, "og:start_time")
        date_str = parse_iso_to_kst_date(raw) if raw else None
        if not date_str or not within_lookback(date_str, now_kst):
            continue
        desc = meta_date(asoup, "og:description") or ""
        out.append({"title": title, "url": url, "date": date_str, "snippet": desc[:300], "source_domain": domain})
    return out


def fetch_tinnews(now_kst: datetime) -> list[dict]:
    """리스트: 홈페이지의 순수 숫자 경로(/12345). 기사: 본문 텍스트 중 '기사입력 YYYY/MM/DD'."""
    domain = "tinnews.co.kr"
    out = []
    try:
        r = get("https://www.tinnews.co.kr/")
        r.raise_for_status()
    except Exception as ex:
        log(f"[{domain}] listing fetch failed: {ex}")
        return out
    soup = BeautifulSoup(r.text, "html.parser")
    seen, items = set(), []
    for a in soup.find_all("a", href=True):
        if re.fullmatch(r"/\d{3,7}", a["href"]) and a["href"] not in seen:
            text = a.get_text(strip=True)
            if text:
                seen.add(a["href"])
                items.append((a["href"], text))
    for href, title in items[:MAX_ARTICLE_FETCHES_PER_SOURCE]:
        url = urljoin("https://www.tinnews.co.kr", href)
        try:
            ar = get(url)
            ar.raise_for_status()
        except Exception as ex:
            log(f"[{domain}] article fetch failed ({url}): {ex}")
            continue
        m = re.search(r"기사입력\s*(\d{4})/(\d{2})/(\d{2})", ar.text)
        if not m:
            continue
        date_str = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
        if not within_lookback(date_str, now_kst):
            continue
        out.append({"title": title, "url": url, "date": date_str, "snippet": "", "source_domain": domain})
    return out


def fetch_fpost(now_kst: datetime) -> list[dict]:
    """그누보드 CMS. 리스트: board.php?bo_table=newsinnews. 기사: 텍스트 중 '작성일 YYYY년 MM월 DD일'."""
    domain = "fpost.co.kr"
    out = []
    try:
        r = get("https://www.fpost.co.kr/board/bbs/board.php?bo_table=newsinnews")
        r.raise_for_status()
    except Exception as ex:
        log(f"[{domain}] listing fetch failed: {ex}")
        return out
    soup = BeautifulSoup(r.text, "html.parser")
    # 그누보드 목록: 같은 wr_id에 imgLink(숫자 배지)/빈 링크/제목(class=bo_tit)/본문미리보기 링크가
    # 반복돼 첫 번째로 만나는 텍스트를 쓰면 안 된다 — class="bo_tit"인 것만 실제 제목이다.
    seen, items = set(), []
    for a in soup.find_all("a", href=True, class_="bo_tit"):
        href = a["href"]
        if "bo_table=newsinnews" in href and "wr_id" in href and href not in seen:
            text = a.get_text(strip=True)
            if text:
                seen.add(href)
                items.append((href, text))
    for href, title in items[:MAX_ARTICLE_FETCHES_PER_SOURCE]:
        url = urljoin("https://www.fpost.co.kr", href)
        try:
            ar = get(url)
            ar.raise_for_status()
        except Exception as ex:
            log(f"[{domain}] article fetch failed ({url}): {ex}")
            continue
        asoup = BeautifulSoup(ar.text, "html.parser")
        text = asoup.get_text("\n", strip=True)
        m = re.search(r"작성일\s*\n?\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일", text)
        if not m:
            continue
        date_str = f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        if not within_lookback(date_str, now_kst):
            continue
        out.append({"title": title, "url": url, "date": date_str, "snippet": "", "source_domain": domain})
    return out


def fetch_apparelnews(now_kst: datetime) -> list[dict]:
    """리스트: /news/news_view/?cat=CATxxx&idx=N 링크 수집. 기사: schema.org NewsArticle datePublished."""
    domain = "apparelnews.co.kr"
    out = []
    try:
        r = get("https://www.apparelnews.co.kr/")
        r.raise_for_status()
    except Exception as ex:
        log(f"[{domain}] listing fetch failed: {ex}")
        return out
    soup = BeautifulSoup(r.text, "html.parser")
    seen, items = set(), []
    for a in soup.find_all("a", href=True):
        if "news_view" in a["href"] and "idx=" in a["href"]:
            href = a["href"]
            if href not in seen:
                text = a.get_text(strip=True)
                if text:
                    seen.add(href)
                    items.append((href, text))
    for href, title in items[:MAX_ARTICLE_FETCHES_PER_SOURCE]:
        url = urljoin("https://www.apparelnews.co.kr/", href)
        try:
            ar = get(url)
            ar.raise_for_status()
        except Exception as ex:
            log(f"[{domain}] article fetch failed ({url}): {ex}")
            continue
        asoup = BeautifulSoup(ar.text, "html.parser")
        raw = ldjson_date(asoup)
        date_str = parse_iso_to_kst_date(raw) if raw else None
        if not date_str or not within_lookback(date_str, now_kst):
            continue
        real_title = title
        tt = asoup.find("title")
        if tt:
            real_title = re.sub(r"^어패럴뉴스\s*-\s*", "", tt.get_text(strip=True)) or title
        out.append({"title": real_title, "url": url, "date": date_str, "snippet": "", "source_domain": domain})
    return out


def fetch_worldfootwear(now_kst: datetime) -> list[dict]:
    """주의: 2026-09-28 작성 시점에 사이트가 503(Service Temporarily Unavailable)로
    지속적으로 응답해 실제 마크업을 확인하지 못했다 — 아래는 검증되지 않은 최선의 추정이다.
    URL 패턴은 이번 세션 중 WebSearch 결과에서 실제로 관측된 형태
    (예: /news/eject-relaunches-brand-with-international-focus/11453.html)를 사용했다.
    사이트가 복구된 뒤 반드시 재검증할 것 — 후보가 계속 0건이면 이 함수부터 의심할 것.
    """
    domain = "worldfootwear.com"
    out = []
    try:
        r = get("https://www.worldfootwear.com/news/world-footwear-news.html")
        r.raise_for_status()
    except Exception as ex:
        log(f"[{domain}] listing fetch failed (site may be down): {ex}")
        return out
    soup = BeautifulSoup(r.text, "html.parser")
    seen, items = set(), []
    for a in soup.find_all("a", href=True):
        if re.search(r"/news/[\w-]+/\d+\.html$", a["href"]) and a["href"] not in seen:
            text = a.get_text(strip=True)
            if text:
                seen.add(a["href"])
                items.append((a["href"], text))
    for href, title in items[:MAX_ARTICLE_FETCHES_PER_SOURCE]:
        url = urljoin("https://www.worldfootwear.com", href)
        try:
            ar = get(url)
            ar.raise_for_status()
        except Exception as ex:
            log(f"[{domain}] article fetch failed ({url}): {ex}")
            continue
        asoup = BeautifulSoup(ar.text, "html.parser")
        raw = ldjson_date(asoup) or meta_date(
            asoup, "article:published_time", "datePublished", "og:updated_time"
        )
        date_str = parse_iso_to_kst_date(raw) if raw else None
        if not date_str or not within_lookback(date_str, now_kst):
            continue
        out.append({"title": title, "url": url, "date": date_str, "snippet": "", "source_domain": domain})
    return out


def fetch_retaildive(now_kst: datetime) -> list[dict]:
    """차단됨: Cloudflare managed JS challenge(2026-09-28 확인, UA를 바꿔도 동일).
    일반 requests로는 원천적으로 못 뚫는다 — 헤드리스 브라우저 없이는 해결 불가하고,
    그건 이 스크립트의 범위를 벗어나는 봇 우회이므로 시도하지 않는다. 빈 리스트만 반환한다.
    """
    log("[retaildive.com] skipped: behind Cloudflare managed challenge (requires a real browser, "
        "not attempting bot-detection bypass) — falls back to no candidates from this source.")
    return []


SCRAPERS = {
    "sportstextiles.com": fetch_sportstextiles,
    "highsnobiety.com": fetch_highsnobiety,
    "fi.co.kr": fetch_fi_co_kr,
    "tinnews.co.kr": fetch_tinnews,
    "fpost.co.kr": fetch_fpost,
    "apparelnews.co.kr": fetch_apparelnews,
    "worldfootwear.com": fetch_worldfootwear,
    "retaildive.com": fetch_retaildive,
}


def fetch_all_candidates(active_domains: set[str], now_kst: datetime) -> list[dict]:
    candidates = []
    for domain, feed_url in RSS_SOURCES.items():
        if domain not in active_domains:
            continue
        found = fetch_rss(domain, feed_url, now_kst)
        log(f"[{domain}] {len(found)} candidate(s) via RSS")
        candidates.extend(found)
    for domain, fn in SCRAPERS.items():
        if domain not in active_domains:
            continue
        found = fn(now_kst)
        log(f"[{domain}] {len(found)} candidate(s) via HTML scrape")
        candidates.extend(found)
    unknown = active_domains - set(RSS_SOURCES) - set(SCRAPERS)
    for domain in unknown:
        log(f"[{domain}] WARNING: no fetcher implemented, skipped entirely")
    return candidates


# ---------------------------------------------------------------------------
# Claude API classification/summarization step (single batched call per run)
# ---------------------------------------------------------------------------

CATEGORY_LIST = "신모델, 신규브랜드, 글로벌비즈니스, 국내비즈니스, 신소재, 생산기술, 유행아이템, 거시트렌드, 미시트렌드"

CLASSIFY_SYSTEM_PROMPT = """당신은 KLAB(K2코리아 신발·의류 소재 평가연구소) 홈페이지의 산업뉴스 편집자입니다.
아래로 전달되는 "후보 기사 목록"은 이미 각 매체에서 실제로 수집한, 발행일이 확인된 진짜 기사입니다.
당신의 역할은 리서치나 사실 확인이 아니라 순수 편집 판단입니다: 그중 무엇을 실을지 고르고,
region(global/domestic)과 category를 분류하고, 같은 사건을 다루는 기사를 issueKey로 묶고,
한국어로 번역·요약하는 것만 합니다.

# 선정 기준
- 신발·스포츠웨어 산업·비즈니스·소재·생산·유행과 직접 관련된 기사만 포함합니다.
- 제외: 단순 할인, 색상 추가, 연예인 화보, 광고성 구매 가이드, 신발과 무관한 일반 소식,
  순수 개인 근황(누가 무엇을 입었다 수준의 가십).
- 외국 브랜드의 한국 매장 개점 등은 domestic으로, 한국 매체가 쓴 해외 시장 기사는 global로 분류합니다.
- 같은 사건을 여러 후보가 다루면 issueKey 하나로 묶고 가장 명확한 기사 하나만 선택합니다.
- category는 반드시 다음 9개 중 하나: {categories}
- 카테고리·출처 다양성을 지키세요: 이미 많이 쌓인 카테고리보다 부족한 카테고리를 우선 고려하세요
  (아래 "기존 보유 현황"을 참고). 특정 매체 하나에 몰아서 고르지 마세요.
- domestic 항목은 이번 실행에서 최대 {domestic_target}건 정도가 현실적인 목표입니다(고정 상한 아님).
  정말 좋은 기사가 더 있다면 넘어도 되고, 부족하면 억지로 채우지 마세요.

# 매우 중요한 제약
- url과 date는 후보 목록에 있는 값을 정확히 그대로 재사용해야 합니다. 절대 새로 만들거나
  변경하지 마세요. 당신은 사실을 검증하는 게 아니라 "이미 검증된 후보 중에서 고르는" 역할입니다.
- 후보에 없는 기사를 지어내지 마세요.
- summary는 한국어 2~3문장, title도 한국어로 자연스럽게 번역/작성하세요(원문이 영어/일본어여도).

# 출력 형식
다른 설명 없이 아래 스키마의 JSON 배열만 출력하세요:
[
  {{
    "region": "global 또는 domestic",
    "issueKey": "영문 소문자-하이픈 슬러그, 고유해야 함",
    "category": "위 9개 카테고리 중 하나",
    "title": "한국어 제목",
    "summary": "한국어 요약 2~3문장",
    "source": "매체명 (예: World Footwear)",
    "url": "후보 목록의 url을 정확히 그대로",
    "date": "후보 목록의 date를 정확히 그대로 (YYYY-MM-DD)"
  }}
]
선정할 만한 후보가 하나도 없으면 빈 배열 []을 출력하세요."""


def build_classification_prompt(candidates: list[dict], category_tally: dict) -> tuple[str, str]:
    """(system_prompt, user_message) 반환. 실제 API 호출 없이도 검토 가능하도록 분리."""
    system = CLASSIFY_SYSTEM_PROMPT.format(categories=CATEGORY_LIST, domestic_target=DOMESTIC_TARGET)
    tally_lines = "\n".join(f"  - {k}: {v}건" for k, v in sorted(category_tally.items())) or "  (없음)"
    cand_lines = []
    for i, c in enumerate(candidates):
        cand_lines.append(
            f"{i+1}. [{c['source_domain']}] {c['title']}\n"
            f"   url: {c['url']}\n"
            f"   date: {c['date']}\n"
            f"   snippet: {c['snippet'][:200]}"
        )
    user = (
        f"# 기존 보유 현황 (region/category별 현재 건수, 28일 롤링 누적 기준)\n{tally_lines}\n\n"
        f"# 후보 기사 목록 ({len(candidates)}건, 최근 {LOOKBACK_DAYS}일 이내 실제 수집)\n"
        + "\n\n".join(cand_lines)
    )
    return system, user


def classify_and_summarize(candidates: list[dict], category_tally: dict) -> list[dict] | None:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        log("ANTHROPIC_API_KEY not set — skipping classification step (no items will be added).")
        return None
    if not candidates:
        return []
    system, user = build_classification_prompt(candidates, category_tally)
    model = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
    import anthropic
    client = anthropic.Anthropic(api_key=api_key, timeout=60.0, max_retries=4)

    raw_text = None
    last_err = None
    # GitHub Actions runners occasionally hit a transient connection failure to
    # api.anthropic.com even though general internet egress works fine (confirmed
    # 2026-09-28 — reproducing locally with the same anthropic version connects
    # cleanly). The SDK's own max_retries covers most of this; a small outer
    # retry with backoff covers the rest without masking a real, persistent failure.
    for attempt in range(1, 4):
        try:
            resp = client.messages.create(
                model=model,
                max_tokens=4096,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
            raw_text = "".join(block.text for block in resp.content if getattr(block, "type", None) == "text")
            break
        except Exception as ex:
            last_err = ex
            log(f"Anthropic API call failed (attempt {attempt}/3): {ex}")
            if attempt < 3:
                time.sleep(10 * attempt)
    if raw_text is None:
        log(f"Anthropic API call failed after 3 attempts: {last_err}")
        return None

    try:
        match = re.search(r"\[.*\]", raw_text, re.S)
        parsed = json.loads(match.group(0) if match else raw_text)
    except Exception as ex:
        log(f"Failed to parse model JSON response: {ex}\nRaw response:\n{raw_text[:2000]}")
        return None

    valid_urls = {c["url"] for c in candidates}
    valid_dates = {c["url"]: c["date"] for c in candidates}
    accepted = []
    for item in parsed if isinstance(parsed, list) else []:
        if not isinstance(item, dict):
            continue
        required = ["region", "issueKey", "category", "title", "summary", "source", "url", "date"]
        if not all(k in item and item[k] for k in required):
            log(f"Dropping model item missing required field: {item}")
            continue
        if item["region"] not in ("global", "domestic"):
            log(f"Dropping model item with bad region: {item}")
            continue
        if item["category"] not in VALID_CATEGORIES:
            log(f"Dropping model item with bad category: {item}")
            continue
        if item["url"] not in valid_urls:
            log(f"Dropping model item whose url wasn't in candidates (possible hallucination): {item['url']}")
            continue
        if item["date"] != valid_dates[item["url"]]:
            log(f"Model changed the date for {item['url']} — overriding back to the scraped value.")
            item["date"] = valid_dates[item["url"]]
        accepted.append(item)
    return accepted


# ---------------------------------------------------------------------------
# Merge into data/industry-news.json + validation
# ---------------------------------------------------------------------------

def merge_and_write(data: dict, accepted: list[dict], now_kst: datetime) -> tuple[dict, int]:
    existing_keys = {it["issueKey"] for it in data["items"]}
    existing_urls = {normalize_url(it["url"]) for it in data["items"]}

    rank_counter = {"global": 0, "domestic": 0}
    new_items = []
    for item in accepted:
        key, url = item["issueKey"], normalize_url(item["url"])
        if key in existing_keys or url in existing_urls:
            continue
        existing_keys.add(key)
        existing_urls.add(url)
        rank_counter[item["region"]] += 1
        new_items.append({
            "rank": rank_counter[item["region"]],
            "region": item["region"],
            "issueKey": item["issueKey"],
            "category": item["category"],
            "title": item["title"],
            "summary": item["summary"],
            "source": item["source"],
            "url": item["url"],
            "date": item["date"],
            "verified": True,  # 실제 fetch로 확보한 날짜/URL이므로 true
        })

    data["items"].extend(new_items)

    cutoff = (now_kst.date() - timedelta(days=WINDOW_DAYS - 1))
    data["items"] = [
        it for it in data["items"]
        if datetime.strptime(it["date"], "%Y-%m-%d").date() >= cutoff
    ]

    domestic_total = sum(1 for it in data["items"] if it["region"] == "domestic")
    if domestic_total < data.get("domesticTarget", DOMESTIC_TARGET):
        data["shortfallReason"] = (
            f"이번 회차 기준 28일 롤링 누적 국내 기사가 {domestic_total}건으로 목표"
            f"({data.get('domesticTarget', DOMESTIC_TARGET)}건)에 못 미칩니다. 검증 가능한 기사만 "
            "실었고 억지로 채우지 않았습니다."
        )
    else:
        data.pop("shortfallReason", None)

    data["updatedAt"] = now_kst.strftime("%Y-%m-%dT%H:%M:%S") + "+09:00"
    return data, len(new_items)


def run_validators() -> tuple[bool, str]:
    combined = ""
    for cmd in (
        ["node", "--test", "scripts/news-policy.test.cjs"],
        ["node", "scripts/validate-news.cjs"],
    ):
        proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        combined += f"$ {' '.join(cmd)}\n{proc.stdout}\n{proc.stderr}\n"
        if proc.returncode != 0:
            return False, combined
    return True, combined


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true",
                         help="fetch(+분류)만 하고 data/industry-news.json은 건드리지 않는다")
    args = parser.parse_args()

    now_kst = datetime.now(KST)
    sources = read_json(DATA_DIR / "news-sources.json")
    active_domains = {s["domain"] for s in sources["sources"] if s["status"] == "active"}

    data_path = DATA_DIR / "industry-news.json"
    original_bytes = data_path.read_bytes()
    data = read_json(data_path)

    category_tally = {}
    for it in data["items"]:
        key = f"{it['region']}/{it['category']}"
        category_tally[key] = category_tally.get(key, 0) + 1
    existing_urls = {normalize_url(it["url"]) for it in data["items"]}

    candidates = fetch_all_candidates(active_domains, now_kst)
    candidates = [c for c in candidates if normalize_url(c["url"]) not in existing_urls]
    log(f"\nTotal fresh candidates after de-dup against existing data: {len(candidates)}")

    if args.dry_run:
        print(json.dumps({"candidates": candidates, "category_tally": category_tally}, ensure_ascii=False, indent=2))
        if os.environ.get("ANTHROPIC_API_KEY") and candidates:
            accepted = classify_and_summarize(candidates, category_tally)
            print("\n--- classification result ---")
            print(json.dumps(accepted, ensure_ascii=False, indent=2))
        return

    if not candidates:
        log("No fresh candidates found this run — nothing to classify, leaving data file untouched.")
        return

    accepted = classify_and_summarize(candidates, category_tally)
    if accepted is None:
        log("Classification step did not run/failed — leaving data file untouched.")
        return
    if not accepted:
        log("Model selected 0 items this run — leaving data file untouched (valid outcome, not an error).")
        return

    data, added = merge_and_write(data, accepted, now_kst)
    data_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    ok, log_output = run_validators()
    if not ok:
        log("Validators failed after merge — reverting data/industry-news.json to its pre-run state.")
        log(log_output)
        data_path.write_bytes(original_bytes)
        sys.exit(1)

    log(f"Added {added} new item(s). Validators passed. data/industry-news.json updated "
        f"(commit/push is handled by the GitHub Actions workflow, not this script).")


if __name__ == "__main__":
    main()
