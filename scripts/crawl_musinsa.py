#!/usr/bin/env python3
"""무신사 랭킹(주간/월간) + 콘텐츠 데이터를 수집해 data/*.json으로 저장한다.
매주 월요일 08:00 KST에 GitHub Actions(.github/workflows/musinsa-dashboard.yml)가 실행한다.
표준 라이브러리만 사용해 별도 의존성 설치 없이 동작한다.
"""
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
HISTORY_DIR = DATA_DIR / "history"
KST = timezone(timedelta(hours=9))
KEEP_SNAPSHOTS = 30  # 하루 최대 3회 갱신, 파일은 날짜별 1개라 30이면 약 한 달치 보관

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

RANKING_URL = "https://client.musinsa.com/api/home/web/v5/pans/ranking/sections/199"
CONTENT_URL = "https://content.musinsa.com/api2/content/musinsa-content/v1/contents"

# KLAB(신발·의류 소재 평가 기관) 업무와 관련 높은 콘텐츠 소분류만 수집한다.
# 뷰티/인터뷰 등은 제외. 코드는 content-category/filter?contentCategoryCode=019 트리 기준.
CONTENT_CATEGORY_CODES = {
    "019003003": "스니커즈",
    "019003002": "트렌드",
    "019003001": "발매소식",
    "019002001": "스타일",
}


def fetch_json(url, params, retries=3):
    query = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{url}?{query}", headers=HEADERS)
    last_error = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError) as exc:
            last_error = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Failed to fetch {url}: {last_error}")


def fetch_ranking(period, top_n=30):
    params = {
        "storeCode": "musinsa",
        "categoryCode": "000",
        "contentsId": "",
        "gf": "A",
        "ageBand": "AGE_BAND_ALL",
        "period": period,
        "subPan": "product",
        "page": 1,
        "offset": 0,
    }
    data = fetch_json(RANKING_URL, params)
    items = []
    for module in data["data"]["modules"]:
        if module["type"] != "MULTICOLUMN":
            continue
        for col in module["items"]:
            if col.get("type") != "PRODUCT_COLUMN":
                continue
            info = col["info"]
            image = col["image"]
            items.append(
                {
                    "rank": image["rank"],
                    "productId": col["id"],
                    "brand": info["brandName"],
                    "name": info["productName"],
                    "price": info.get("finalPrice"),
                    "discountRatio": info.get("discountRatio", 0),
                    "imageUrl": image["url"],
                    "url": f"https://www.musinsa.com/products/{col['id']}",
                }
            )
    items.sort(key=lambda x: x["rank"])
    return items[:top_n]


def fetch_content(display_n=10, pool_per_category=15):
    """무신사 콘텐츠 API는 '인기순' 정렬 파라미터를 지원하지 않아(LATEST만 확인됨),
    카테고리별 최근 발행 글 pool_per_category개씩 모은 뒤 조회수(viewCount) 기준으로
    전체 상위 display_n개를 추린다. 신발·의류 소재 리서치와 관련 높은 소분류만 수집한다
    (CONTENT_CATEGORY_CODES 참고, 뷰티 등은 제외).
    """
    items_by_id = {}
    for code in CONTENT_CATEGORY_CODES:
        params = {
            "contentCategoryCode": code,
            "sort": "LATEST",
            "page": 1,
            "size": pool_per_category,
        }
        data = fetch_json(CONTENT_URL, params)
        for c in data["data"]["list"]:
            items_by_id[c["id"]] = {
                "id": c["id"],
                "title": c.get("title"),
                "summary": c.get("summary"),
                "thumbnailUrl": c.get("thumbnailUrl"),
                "url": c.get("landingUrl") or f"https://www.musinsa.com/content/{c.get('cmsIndex')}",
                "category": c.get("attributeDictionaryName"),
                # 시즌 캠페인성 글은 브랜드가 수백 개씩 태그되기도 해 앞 3개만 보존한다.
                "brands": (c.get("brandNameList") or [])[:3],
                "viewCount": c.get("viewCount", 0),
                "commentCount": c.get("commentCount", 0),
                "date": c.get("displayStartDate"),
            }
    items = sorted(items_by_id.values(), key=lambda x: x["viewCount"], reverse=True)
    return items[:display_n]


def compute_rank_changes(current_items, previous_items):
    prev_rank_by_id = {p["productId"]: p["rank"] for p in previous_items} if previous_items else {}
    for item in current_items:
        prev_rank = prev_rank_by_id.get(item["productId"])
        item["rankChange"] = None if prev_rank is None else prev_rank - item["rank"]
        item["isNew"] = prev_rank is None
    return current_items


def load_previous_items(period_key):
    history_dir = HISTORY_DIR / period_key
    if not history_dir.exists():
        return None
    snapshots = sorted(history_dir.glob("*.json"))
    if not snapshots:
        return None
    with open(snapshots[-1], encoding="utf-8") as f:
        return json.load(f)["items"]


def save_snapshot(period_key, payload, date_str):
    history_dir = HISTORY_DIR / period_key
    history_dir.mkdir(parents=True, exist_ok=True)
    with open(history_dir / f"{date_str}.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    snapshots = sorted(history_dir.glob("*.json"))
    for old in snapshots[:-KEEP_SNAPSHOTS]:
        old.unlink()


def main():
    now_kst = datetime.now(KST)
    date_str = now_kst.strftime("%Y-%m-%d")
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    for period_key, period_param in (("weekly", "WEEKLY"), ("monthly", "MONTHLY")):
        items = fetch_ranking(period_param, top_n=30)
        previous = load_previous_items(period_key)
        items = compute_rank_changes(items, previous)
        payload = {"updatedAt": now_kst.isoformat(), "period": period_param, "items": items}
        with open(DATA_DIR / f"{period_key}.json", "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        save_snapshot(period_key, payload, date_str)
        print(f"[{period_key}] saved {len(items)} items")

    content_payload = {
        "updatedAt": now_kst.isoformat(),
        "sortedBy": "viewCount",
        "items": fetch_content(display_n=10, pool_per_category=15),
    }
    with open(DATA_DIR / "content.json", "w", encoding="utf-8") as f:
        json.dump(content_payload, f, ensure_ascii=False, indent=2)
    print(f"[content] saved {len(content_payload['items'])} items")


if __name__ == "__main__":
    main()
