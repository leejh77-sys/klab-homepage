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
import zipfile
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

# 워드/파워포인트에 흔히 박혀있는 윈도우 전용(라이선스상 리눅스에 설치 불가) 한글 폰트를
# CI 서버에 실제로 설치되는 무료 폰트로 치환한다. 이름만 바꾸는 것 - 내용은 그대로.
FONT_REPLACEMENTS = {
    "맑은 고딕": "NanumGothic",
    "맑은고딕": "NanumGothic",
    "굴림체": "NanumGothic",
    "굴림": "NanumGothic",
    "돋움체": "NanumGothic",
    "돋움": "NanumGothic",
    "바탕체": "NanumMyeongjo",
    "바탕": "NanumMyeongjo",
    "궁서체": "NanumMyeongjo",
    "궁서": "NanumMyeongjo",
}
# OOXML(docx/pptx)은 zip 안에 이 확장자의 XML로 폰트를 지정한다.
OOXML_EXTS = {".docx", ".pptx"}


def normalize_fonts(src: Path) -> Path:
    """docx/pptx 안 XML의 폰트 이름을 설치된 무료 폰트로 바꾼 사본을 만들어 반환한다."""
    normalized = src.with_name(f"__normfont_{src.name}")
    with zipfile.ZipFile(src, "r") as zin, zipfile.ZipFile(normalized, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.endswith(".xml") or item.filename.endswith(".rels"):
                try:
                    text = data.decode("utf-8")
                except UnicodeDecodeError:
                    zout.writestr(item, data)
                    continue
                for old, new in FONT_REPLACEMENTS.items():
                    text = text.replace(old, new)
                data = text.encode("utf-8")
            zout.writestr(item, data)
    return normalized


def convert_to_pdf(src: Path) -> bool:
    convert_src = src
    normalized = None
    if src.suffix.lower() in OOXML_EXTS:
        try:
            normalized = normalize_fonts(src)
            convert_src = normalized
        except (zipfile.BadZipFile, OSError) as exc:
            print(f"[warn] 폰트 치환 실패, 원본으로 변환 시도: {src.name} ({exc})", file=sys.stderr)

    try:
        result = subprocess.run(
            ["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(src.parent), str(convert_src)],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except FileNotFoundError:
        print(f"[warn] soffice(LibreOffice)가 없어 변환을 건너뜁니다: {src.name}", file=sys.stderr)
        return False
    finally:
        if normalized is not None:
            normalized.unlink(missing_ok=True)

    if result.returncode != 0:
        print(f"[warn] PDF 변환 실패: {src.name}\n{result.stderr}", file=sys.stderr)
        return False

    if normalized is not None:
        # soffice가 임시 파일 이름(__normfont_...) 그대로 pdf를 만들었으니 원래 이름으로 되돌린다.
        generated = src.parent / f"{normalized.stem}.pdf"
        target = src.parent / f"{src.stem}.pdf"
        if generated.exists():
            generated.replace(target)
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

    manifest_path = DATA_DIR / "reports.json"
    previous_items = None
    if manifest_path.exists():
        try:
            previous_items = json.loads(manifest_path.read_text(encoding="utf-8")).get("items")
        except (json.JSONDecodeError, OSError):
            previous_items = None

    if previous_items == all_items:
        print(f"[reports] no changes ({len(all_items)} items) - manifest not rewritten")
        return

    payload = {"updatedAt": datetime.now(KST).isoformat(), "items": all_items}
    manifest_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[reports] saved {len(all_items)} items")


if __name__ == "__main__":
    main()
