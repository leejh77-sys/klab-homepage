#!/usr/bin/env python3
"""reports/{tech,trend,trip,company} 폴더를 스캔해 최신정보 페이지용 데이터를 만든다.
- PDF가 아닌 문서(docx/doc/pptx/ppt)는 LibreOffice(soffice)로 PDF 변환
- 모든 PDF를 모아 data/reports.json 매니페스트 생성 (news.html이 fetch해서 렌더링)
매일/보고서 업로드 시 GitHub Actions(.github/workflows/build-reports.yml)가 실행한다.
"""
import json
import re
import subprocess
import sys
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPORTS_DIR = ROOT / "reports"
DATA_DIR = ROOT / "data"
KST = timezone(timedelta(hours=9))

CATEGORIES = {
    "tech": "신기술·신제품",
    "trend": "산업 트렌드",
    "trip": "해외출장",
    "company": "신규업체정보",
}

CONVERTIBLE_EXTS = {".docx", ".doc", ".pptx", ".ppt"}
SKIP_NAMES = {".gitkeep"}


def convert_to_pdf(src: Path) -> bool:
    try:
        result = subprocess.run(
            ["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(src.parent), str(src)],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except FileNotFoundError:
        print(f"[warn] soffice(LibreOffice)가 없어 변환을 건너뜁니다: {src.name}", file=sys.stderr)
        return False
    if result.returncode != 0:
        print(f"[warn] PDF 변환 실패: {src.name}\n{result.stderr}", file=sys.stderr)
        return False
    return True


def title_from_filename(stem: str) -> str:
    title = re.sub(r"[_\-]+", " ", stem).strip()
    return title or stem


def git_first_added_date(path: Path) -> str:
    try:
        result = subprocess.run(
            ["git", "log", "--follow", "--format=%aI", "--", str(path.relative_to(ROOT))],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=15,
        )
        lines = [l for l in result.stdout.strip().splitlines() if l]
        if lines:
            return lines[-1]
    except Exception:
        pass
    return datetime.now(KST).isoformat()


def build_category(code: str) -> list:
    folder = REPORTS_DIR / code
    if not folder.exists():
        return []

    # 1) 변환이 필요한 원본 문서를 PDF로 만든다.
    for src in sorted(folder.iterdir()):
        if src.name in SKIP_NAMES or src.is_dir():
            continue
        if src.suffix.lower() in CONVERTIBLE_EXTS:
            convert_to_pdf(src)

    # 2) 폴더 안의 모든 PDF를 리포트 항목으로 만든다.
    items = []
    for pdf in sorted(folder.glob("*.pdf")):
        rel_path = pdf.relative_to(ROOT).as_posix()
        url = urllib.parse.quote(rel_path, safe="/")
        date_iso = git_first_added_date(pdf)
        items.append(
            {
                "title": title_from_filename(pdf.stem),
                "category": code,
                "categoryLabel": CATEGORIES[code],
                "url": url,
                "date": date_iso,
                "fileSize": pdf.stat().st_size,
            }
        )
    return items


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    all_items = []
    for code in CATEGORIES:
        all_items.extend(build_category(code))

    all_items.sort(key=lambda x: x["date"], reverse=True)

    payload = {"updatedAt": datetime.now(KST).isoformat(), "items": all_items}
    with open(DATA_DIR / "reports.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"[reports] saved {len(all_items)} items")


if __name__ == "__main__":
    main()
