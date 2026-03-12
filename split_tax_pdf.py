import argparse
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Optional


def parse_bbox(value: str):
    parts = [part.strip() for part in value.split(",") if part.strip()]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("bbox must be 'x0,top,x1,bottom'")
    try:
        return tuple(float(part) for part in parts)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("bbox values must be numbers") from exc


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


_RRN_REGEX = re.compile(r"\b(\d{6})\s*-\s*(\d{7})\b")
_WORK_PERIOD_REGEX = re.compile(
    r"근무기간\s*([0-9]{4}\.[0-9]{2}\.[0-9]{2})\s*~"
)
_DATE_RANGE_REGEX = re.compile(r"([0-9]{4}\.[0-9]{2}\.[0-9]{2})\s*~")
_GROUP_START_MARKER_REGEX = re.compile(
    r"\(\s*\d+\s*쪽\s*중\s*제\s*1\s*쪽\s*\)"
)
_OCR_DATE_DOTTED_REGEX = re.compile(
    r"([12][0-9]{3})\D{1,3}([01]?[0-9])\D{1,3}([0-3]?[0-9])"
)
_OCR_DATE_COMPACT_REGEX = re.compile(r"\b([12][0-9]{3})([01][0-9])([0-3][0-9])\b")


def extract_rrn(text: str):
    match = _RRN_REGEX.search(text)
    if not match:
        return None
    return f"{match.group(1)}-{match.group(2)}"


def extract_start_date(text: str):
    match = _WORK_PERIOD_REGEX.search(text)
    if not match:
        match = _DATE_RANGE_REGEX.search(text)
    if not match:
        return None
    return match.group(1).replace(".", "-")


def normalize_ocr_text(value: str) -> str:
    value = value or ""
    replacements = {
        "O": "0",
        "o": "0",
        "I": "1",
        "l": "1",
        "|": "1",
        "S": "5",
        "s": "5",
        "B": "8",
    }
    for src, dst in replacements.items():
        value = value.replace(src, dst)
    value = value.replace("\u00a0", " ")
    return normalize_text(value)


def extract_start_date_from_ocr(text: str):
    normalized = normalize_ocr_text(text)
    match = _OCR_DATE_COMPACT_REGEX.search(normalized.replace(" ", ""))
    if match:
        year, month, day = match.groups()
        month_int = int(month)
        day_int = int(day)
        if 1 <= month_int <= 12 and 1 <= day_int <= 31:
            return f"{year}-{month}-{day}"

    match = _OCR_DATE_DOTTED_REGEX.search(normalized)
    if not match:
        return None

    year, month_raw, day_raw = match.groups()
    try:
        month_int = int(month_raw)
        day_int = int(day_raw)
    except ValueError:
        return None
    if not (1 <= month_int <= 12 and 1 <= day_int <= 31):
        return None
    return f"{year}-{month_int:02d}-{day_int:02d}"


def guess_work_period_bbox(page):
    try:
        words = page.extract_words() or []
    except Exception:
        words = []

    candidates = []
    for word in words:
        text = normalize_text(word.get("text"))
        if not text:
            continue
        compact = text.replace(" ", "")
        if "근무기간" in compact:
            candidates.append(word)

    if not candidates:
        return None

    label = min(candidates, key=lambda item: (item.get("top", 0), item.get("x0", 0)))
    label_height = float(label.get("height") or 0) or float(label.get("bottom", 0)) - float(
        label.get("top", 0)
    )
    pad = max(0.0, min(2.0, label_height * 0.3))
    x0 = float(label.get("x1", 0)) + 5.0
    top = float(label.get("top", 0)) - pad
    bottom = float(label.get("bottom", 0)) + pad
    x1 = float(getattr(page, "width", 0) or 0)
    height = float(getattr(page, "height", 0) or 0)

    if x1 <= 0 or height <= 0:
        return None

    x0 = max(0.0, min(x0, x1))
    top = max(0.0, min(top, height))
    bottom = max(top, min(bottom, height))

    return (x0, top, x1, bottom)


def ocr_start_date_from_page(page, bbox, *, resolution=300, lang="eng"):
    try:
        from PIL import ImageOps
    except ImportError:
        return None, "missing_pillow"

    try:
        rendered = page.to_image(resolution=resolution)
        scale = float(getattr(rendered, "scale", resolution / 72))
        x0, top, x1, bottom = bbox
        crop_box = (
            int(max(0, x0 * scale)),
            int(max(0, top * scale)),
            int(max(0, x1 * scale)),
            int(max(0, bottom * scale)),
        )
        if crop_box[2] <= crop_box[0] or crop_box[3] <= crop_box[1]:
            return None, None
        image = rendered.original.crop(crop_box)
        image = image.convert("L")
        image = ImageOps.autocontrast(image)
        image = image.point(lambda value: 0 if value < 160 else 255)
    except Exception:
        return None, None

    raw = ""
    config = "--psm 6 -c tessedit_char_whitelist=0123456789.-~/"
    try:
        import pytesseract
        from pytesseract import TesseractNotFoundError

        try:
            raw = pytesseract.image_to_string(image, lang=lang, config=config)
        except TesseractNotFoundError:
            return None, "missing_tesseract"
    except Exception:
        tesseract_path = shutil.which("tesseract")
        if not tesseract_path:
            return None, "missing_tesseract"

        try:
            with tempfile.TemporaryDirectory() as tmp_dir:
                tmp_path = Path(tmp_dir) / "crop.png"
                image.save(tmp_path)
                result = subprocess.run(
                    [
                        tesseract_path,
                        str(tmp_path),
                        "stdout",
                        "-l",
                        lang,
                        "--psm",
                        "6",
                        "-c",
                        "tessedit_char_whitelist=0123456789.-~/",
                    ],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                raw = (result.stdout or "")
        except Exception:
            return None, None

    start_date = extract_start_date_from_ocr(raw)
    return start_date, None


def page_has_group_start_marker(page) -> bool:
    try:
        text = page.extract_text() or ""
    except Exception:
        return False
    if not text:
        return False
    if "제1쪽" not in text:
        return False
    return _GROUP_START_MARKER_REGEX.search(text) is not None


def build_group_ranges(plumber_pdf, start_index: int, total_pages: int, *, group_mode: str, pages_per_person: int):
    if group_mode not in {"auto", "fixed", "marker"}:
        raise ValueError("group_mode must be auto, fixed, or marker")

    if group_mode == "fixed":
        for group_start in range(start_index, total_pages, pages_per_person):
            yield group_start, min(group_start + pages_per_person, total_pages)
        return

    marker_starts = []
    for page_index in range(start_index, total_pages):
        if page_has_group_start_marker(plumber_pdf.pages[page_index]):
            marker_starts.append(page_index)

    if not marker_starts:
        if group_mode == "marker":
            print(
                "경고: 페이지 마커(제1쪽) 기반 그룹핑을 요청했지만 마커를 찾지 못했습니다. pages-per-person 기준으로 진행합니다.",
                file=sys.stderr,
            )
        for group_start in range(start_index, total_pages, pages_per_person):
            yield group_start, min(group_start + pages_per_person, total_pages)
        return

    if marker_starts[0] != start_index:
        print(
            "경고: --start-page가 그룹 시작(제1쪽) 페이지가 아닙니다. 첫 그룹은 start-page부터 시작하며 RRN/입사일이 unknown일 수 있습니다.",
            file=sys.stderr,
        )
        marker_starts = [start_index] + marker_starts

    for idx, group_start in enumerate(marker_starts):
        group_end = marker_starts[idx + 1] if idx + 1 < len(marker_starts) else total_pages
        if group_end <= group_start:
            continue
        yield group_start, group_end


def mask_rrn(rrn: str) -> str:
    if len(rrn) != 14 or rrn[6] != "-":
        return rrn
    return f"{rrn[:8]}{'*' * 6}"


def safe_filename(value: str) -> str:
    cleaned = re.sub(r"[\\/\0]", "_", value)
    cleaned = cleaned.replace(":", "_")
    cleaned = cleaned.replace("\n", " ").replace("\r", " ").strip()
    cleaned = re.sub(r"\s+", "_", cleaned)
    cleaned = cleaned.strip(". ")
    return cleaned or "unknown"


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    for index in range(2, 10000):
        candidate = path.with_name(f"{stem}_{index}{suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"Unable to find unique filename for {path.name}")


def extract_page_text(page, bbox):
    try:
        if bbox is not None:
            return page.within_bbox(bbox).extract_text() or ""
        return page.extract_text() or ""
    except Exception:
        return ""


def extract_metadata(
    plumber_pdf,
    start_index: int,
    end_index: int,
    rrn_box,
    work_box,
    *,
    ocr_enabled: bool = True,
    ocr_resolution: int = 300,
    ocr_lang: str = "eng",
    ocr_state: Optional[dict] = None,
):
    first_page = plumber_pdf.pages[start_index]
    rrn_text = normalize_text(extract_page_text(first_page, rrn_box))
    work_text = normalize_text(extract_page_text(first_page, work_box))

    rrn_value = extract_rrn(rrn_text)
    start_date_value = extract_start_date(work_text)

    if rrn_value and start_date_value:
        return rrn_value, start_date_value

    combined_rrn_text_parts = [rrn_text]
    combined_work_text_parts = [work_text]

    for page_index in range(start_index + 1, end_index):
        page = plumber_pdf.pages[page_index]
        combined_rrn_text_parts.append(normalize_text(extract_page_text(page, rrn_box)))
        combined_work_text_parts.append(normalize_text(extract_page_text(page, work_box)))

    combined_rrn_text = " ".join(combined_rrn_text_parts)
    combined_work_text = " ".join(combined_work_text_parts)

    rrn_value = rrn_value or extract_rrn(combined_rrn_text)
    start_date_value = start_date_value or extract_start_date(combined_work_text)

    if start_date_value or not ocr_enabled:
        return rrn_value, start_date_value

    ocr_state = ocr_state if ocr_state is not None else {}
    for page_index in range(start_index, end_index):
        page = plumber_pdf.pages[page_index]
        bbox = work_box or guess_work_period_bbox(page)
        if bbox is None:
            continue
        ocr_value, ocr_issue = ocr_start_date_from_page(
            page,
            bbox,
            resolution=ocr_resolution,
            lang=ocr_lang,
        )
        if ocr_value:
            start_date_value = ocr_value
            break
        if ocr_issue and not ocr_state.get(ocr_issue):
            ocr_state[ocr_issue] = True
            if ocr_issue == "missing_tesseract":
                print(
                    "OCR 비활성화: tesseract 실행파일을 찾을 수 없습니다 (mac: brew install tesseract). 입사일이 unknown으로 남을 수 있습니다.",
                    file=sys.stderr,
                )
            elif ocr_issue == "missing_pillow":
                print(
                    "OCR 비활성화: Pillow 미설치. 입사일이 unknown으로 남을 수 있습니다.",
                    file=sys.stderr,
                )

    return rrn_value, start_date_value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", help="Input PDF path")
    parser.add_argument("--output-dir", default="split_output")
    parser.add_argument("--zip-path", default="split_output.zip")
    parser.add_argument("--no-zip", action="store_true")
    parser.add_argument("--pages-per-person", type=int, default=3)
    parser.add_argument(
        "--group-mode",
        choices=["auto", "fixed", "marker"],
        default="auto",
    )
    parser.add_argument("--start-page", type=int, default=1)
    parser.add_argument("--mask-rrn", action="store_true")
    parser.add_argument("--rrn-box", type=parse_bbox, default=None)
    parser.add_argument("--work-period-box", type=parse_bbox, default=None)
    parser.add_argument("--no-ocr", action="store_true")
    parser.add_argument("--ocr-resolution", type=int, default=300)
    parser.add_argument("--ocr-lang", default="eng")
    parser.add_argument("--max-groups", type=int, default=None)

    args = parser.parse_args()

    input_path = Path(args.pdf).expanduser().resolve()
    if not input_path.exists():
        print(f"Input PDF not found: {input_path}", file=sys.stderr)
        return 2

    if args.pages_per_person < 1:
        print("--pages-per-person must be >= 1", file=sys.stderr)
        return 2

    if args.start_page < 1:
        print("--start-page must be >= 1", file=sys.stderr)
        return 2

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError:
        print(
            "Missing dependency: pypdf. Install with: python3 -m pip install pypdf pdfplumber",
            file=sys.stderr,
        )
        return 2

    try:
        import pdfplumber
    except ImportError:
        print(
            "Missing dependency: pdfplumber. Install with: python3 -m pip install pypdf pdfplumber",
            file=sys.stderr,
        )
        return 2

    reader = PdfReader(str(input_path))
    total_pages = len(reader.pages)

    start_index = args.start_page - 1
    if start_index >= total_pages:
        print(
            f"--start-page {args.start_page} is beyond total pages {total_pages}",
            file=sys.stderr,
        )
        return 2

    created_files = []
    unknown_rrn_count = 0
    unknown_date_count = 0
    ocr_state = {}

    with pdfplumber.open(str(input_path)) as plumber_pdf:
        group_number = 0
        group_mode = args.group_mode
        if group_mode == "auto":
            group_mode = "marker"

        for group_start, group_end in build_group_ranges(
            plumber_pdf,
            start_index,
            total_pages,
            group_mode=group_mode,
            pages_per_person=args.pages_per_person,
        ):

            group_number += 1
            if args.max_groups is not None and group_number > args.max_groups:
                break

            rrn_value, start_date_value = extract_metadata(
                plumber_pdf,
                group_start,
                group_end,
                args.rrn_box,
                args.work_period_box,
                ocr_enabled=not args.no_ocr,
                ocr_resolution=args.ocr_resolution,
                ocr_lang=args.ocr_lang,
                ocr_state=ocr_state,
            )

            if not rrn_value:
                unknown_rrn_count += 1
                rrn_value = f"unknown_{group_number}"

            if not start_date_value:
                unknown_date_count += 1
                start_date_value = "unknown"

            if args.mask_rrn:
                rrn_value = mask_rrn(rrn_value)

            base_name = safe_filename(f"{rrn_value}_{start_date_value}")
            target_path = unique_path(output_dir / f"{base_name}.pdf")

            writer = PdfWriter()
            for page_index in range(group_start, group_end):
                writer.add_page(reader.pages[page_index])

            with open(target_path, "wb") as handle:
                writer.write(handle)

            created_files.append(target_path)

    if not args.no_zip:
        zip_path = Path(args.zip_path)
        with zipfile.ZipFile(
            zip_path, "w", compression=zipfile.ZIP_DEFLATED
        ) as archive:
            for file_path in created_files:
                archive.write(file_path, arcname=file_path.name)

    print(f"완료: {len(created_files)}개 PDF 생성")
    print(f"RRN 미검출: {unknown_rrn_count}")
    print(f"입사일 미검출: {unknown_date_count}")
    print(f"출력 폴더: {output_dir.resolve()}")
    if not args.no_zip:
        print(f"ZIP: {Path(args.zip_path).resolve()}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
