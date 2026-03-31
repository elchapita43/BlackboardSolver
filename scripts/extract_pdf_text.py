import json
import sys
from pathlib import Path


def extract_with_pypdf(pdf_path: Path) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(pdf_path))
    parts: list[str] = []
    for page in reader.pages:
        text = page.extract_text() or ""
        text = text.strip()
        if text:
            parts.append(text)
    return "\n\n".join(parts).strip()


def extract_with_pdfplumber(pdf_path: Path) -> str:
    import pdfplumber

    parts: list[str] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            text = text.strip()
            if text:
                parts.append(text)
    return "\n\n".join(parts).strip()


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Missing PDF path"}))
        return 1

    pdf_path = Path(sys.argv[1]).resolve()
    if not pdf_path.exists():
        print(json.dumps({"ok": False, "error": "PDF not found"}))
        return 1

    errors: list[str] = []
    text = ""

    try:
        text = extract_with_pypdf(pdf_path)
    except Exception as exc:
        errors.append(f"pypdf: {exc}")

    if not text:
        try:
            text = extract_with_pdfplumber(pdf_path)
        except Exception as exc:
            errors.append(f"pdfplumber: {exc}")

    print(
        json.dumps(
            {
                "ok": True,
                "text": text,
                "needsOcr": not bool(text.strip()),
                "warnings": errors,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
