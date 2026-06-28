from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np
import pdfplumber
import pytesseract
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pdf2image import convert_from_bytes
from pypdf import PdfReader
from pypdf.errors import PdfReadError
from pytesseract import Output


app = FastAPI(title="PDF Form Editor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@dataclass(frozen=True)
class Primitive:
    kind: str
    page_number: int
    x: int
    y: int
    width: int
    height: int


@dataclass(frozen=True)
class OcrWord:
    text: str
    x: int
    y: int
    width: int
    height: int


@dataclass(frozen=True)
class TableCell:
    page_number: int
    row_index: int
    column_index: int
    page_width: float
    page_height: float
    x0: float
    y0: float
    x1: float
    y1: float
    text: str
    selection_tokens: tuple[dict[str, Any], ...]


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/analyze-pdf")
async def analyze_pdf(file: UploadFile = File(...)) -> list[dict[str, Any]]:
    if not _looks_like_pdf(file):
        raise HTTPException(status_code=400, detail="Upload must be a PDF file.")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Uploaded PDF is empty.")

    try:
        return await run_in_threadpool(_analyze_pdf_bytes, pdf_bytes)
    except HTTPException:
        raise
    except PdfReadError as exc:
        raise HTTPException(status_code=400, detail="Malformed or corrupted PDF stream.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"PDF analysis failed: {exc}") from exc


def _looks_like_pdf(file: UploadFile) -> bool:
    content_type = (file.content_type or "").lower()
    filename = (file.filename or "").lower()
    return content_type in {"application/pdf", "application/x-pdf"} or filename.endswith(".pdf")


def _analyze_pdf_bytes(pdf_bytes: bytes) -> list[dict[str, Any]]:
    _validate_pdf(pdf_bytes)
    vector_cells = _extract_table_cells(pdf_bytes)

    try:
        pages = convert_from_bytes(pdf_bytes, dpi=150)
    except Exception as exc:
        if vector_cells:
            return _serialize_table_cells(vector_cells)
        raise ValueError("Could not rasterize PDF. Ensure the file is valid and Poppler is installed.") from exc

    if not pages:
        raise ValueError("PDF did not contain any renderable pages.")

    fields: list[dict[str, Any]] = []
    field_number = 1

    fields.extend(_serialize_table_cells(vector_cells))
    field_number = len(fields) + 1

    for page_index, image in enumerate(pages, start=1):
        page_width, page_height = image.size
        gray = cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2GRAY)
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)

        primitives = _filter_primitives_outside_table_cells(
            _detect_primitives(binary, page_index, page_width, page_height),
            [cell for cell in vector_cells if cell.page_number == page_index],
            page_width,
            page_height,
        )
        ocr_words = _extract_ocr_words(image)

        for primitive in primitives:
            anchor = _find_anchor_text(primitive, ocr_words)
            field_type = _infer_field_type(primitive, anchor)
            fields.append(
                {
                    "page_number": page_index,
                    "field_id": f"field_{field_number}",
                    "type": field_type,
                    "label_context": anchor,
                    "geometry": _normalize_geometry(primitive, page_width, page_height),
                }
            )
            field_number += 1

    return fields


def _extract_table_cells(pdf_bytes: bytes) -> list[TableCell]:
    cells: list[TableCell] = []

    table_settings = {
        "vertical_strategy": "lines",
        "horizontal_strategy": "lines",
        "intersection_tolerance": 4,
        "snap_tolerance": 3,
        "join_tolerance": 3,
        "edge_min_length": 8,
    }

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page_index, page in enumerate(pdf.pages, start=1):
            try:
                tables = page.find_tables(table_settings=table_settings)
            except Exception:
                tables = []

            for table in tables:
                for row_index, row in enumerate(getattr(table, "rows", [])):
                    for column_index, bbox in enumerate(getattr(row, "cells", [])):
                        if not bbox:
                            continue
                        x0, top, x1, bottom = bbox
                        if x1 <= x0 or bottom <= top:
                            continue

                        cell_text = _extract_cell_text(page, bbox)
                        cells.append(
                            TableCell(
                                page_number=page_index,
                                row_index=row_index,
                                column_index=column_index,
                                page_width=float(page.width),
                                page_height=float(page.height),
                                x0=float(x0),
                                y0=float(top),
                                x1=float(x1),
                                y1=float(bottom),
                                text=cell_text,
                                selection_tokens=tuple(_extract_cell_selection_tokens(page, bbox)),
                            )
                        )

    return _dedupe_table_cells(cells)


def _extract_cell_text(page: Any, bbox: tuple[float, float, float, float]) -> str:
    try:
        text = page.within_bbox(bbox).extract_text(x_tolerance=2, y_tolerance=3) or ""
    except Exception:
        return ""
    return re.sub(r"\s+", " ", text).strip()


def _extract_cell_selection_tokens(page: Any, bbox: tuple[float, float, float, float]) -> list[dict[str, Any]]:
    x0, top, x1, bottom = bbox
    cell_width = max(x1 - x0, 1.0)
    cell_height = max(bottom - top, 1.0)

    try:
        chars = [
            char
            for char in page.within_bbox(bbox).chars
            if str(char.get("text", "")).strip()
        ]
    except Exception:
        return []

    tokens: list[dict[str, Any]] = []
    checkbox_glyphs = {"☐", "□", "☑", "☒"}

    for index, char in enumerate(chars):
        text = str(char.get("text", "")).strip()
        if text not in checkbox_glyphs:
            continue

        value = _find_following_selection_value(char, chars[index + 1 :])
        if value not in {"M", "F", "Y", "N"}:
            continue

        tokens.append(_local_square_token(char, x0, top, cell_width, cell_height, value))

    if tokens:
        return tokens

    for char in chars:
        text = str(char.get("text", "")).strip().upper()
        if text in {"M", "F"}:
            tokens.append(_local_square_token(char, x0, top, cell_width, cell_height, text))

    return tokens


def _find_following_selection_value(source_char: dict[str, Any], following_chars: list[dict[str, Any]]) -> str:
    source_mid_y = (_num(source_char.get("top")) + _num(source_char.get("bottom"))) / 2
    source_right = _num(source_char.get("x1"))

    for char in following_chars[:8]:
        text = str(char.get("text", "")).strip().upper()
        if not text:
            continue

        char_mid_y = (_num(char.get("top")) + _num(char.get("bottom"))) / 2
        if abs(char_mid_y - source_mid_y) > 8:
            continue
        if _num(char.get("x0")) < source_right:
            continue
        if text in {"M", "F", "Y", "N"}:
            return text

    return ""


def _local_square_token(
    char: dict[str, Any],
    cell_x0: float,
    cell_top: float,
    cell_width: float,
    cell_height: float,
    value: str,
) -> dict[str, Any]:
    char_x0 = _num(char.get("x0"))
    char_top = _num(char.get("top"))
    char_width = max(_num(char.get("x1")) - char_x0, 1.0)
    char_height = max(_num(char.get("bottom")) - char_top, 1.0)
    side = max(char_width, char_height)

    return {
        "value": value,
        "geometry": {
            "x": _clamp((char_x0 - cell_x0) / cell_width),
            "y": _clamp((char_top - cell_top) / cell_height),
            "width": _clamp(side / cell_width),
            "height": _clamp(side / cell_height),
        },
    }


def _serialize_table_cells(cells: list[TableCell]) -> list[dict[str, Any]]:
    serialized: list[dict[str, Any]] = []

    for index, cell in enumerate(cells, start=1):
        page_width = max(cell.page_width, 1.0)
        page_height = max(cell.page_height, 1.0)
        x = _clamp(cell.x0 / page_width)
        y = _clamp(cell.y0 / page_height)
        width = _clamp((cell.x1 - cell.x0) / page_width)
        height = _clamp((cell.y1 - cell.y0) / page_height)
        bbox = [
            float(x),
            float(y),
            float(min(1.0, cell.x1 / page_width)),
            float(min(1.0, cell.y1 / page_height)),
        ]

        serialized.append(
            {
                "page_number": cell.page_number,
                "field_id": f"table_cell_{cell.page_number}_{cell.row_index}_{cell.column_index}_{index}",
                "type": "table_cell",
                "label_context": cell.text,
                "bbox": bbox,
                "geometry": {
                    "x": float(x),
                    "y": float(y),
                    "width": float(min(width, 1.0 - x)),
                    "height": float(min(height, 1.0 - y)),
                },
                "column_index": cell.column_index,
                "row_index": cell.row_index,
                "selection_tokens": list(cell.selection_tokens),
            }
        )

    return serialized


def _dedupe_table_cells(cells: list[TableCell]) -> list[TableCell]:
    sorted_cells = sorted(cells, key=lambda cell: (cell.page_number, cell.y0, cell.x0, cell.y1, cell.x1))
    unique: list[TableCell] = []

    for cell in sorted_cells:
        if any(_cell_intersection_over_union(cell, existing) > 0.9 for existing in unique):
            continue
        unique.append(cell)

    return unique


def _filter_primitives_outside_table_cells(
    primitives: list[Primitive],
    cells: list[TableCell],
    raster_page_width: int,
    raster_page_height: int,
) -> list[Primitive]:
    if not cells:
        return primitives

    filtered: list[Primitive] = []
    for primitive in primitives:
        center_x = primitive.x + primitive.width / 2
        center_y = primitive.y + primitive.height / 2
        if any(_primitive_center_inside_cell(center_x, center_y, cell, raster_page_width, raster_page_height) for cell in cells):
            continue
        filtered.append(primitive)

    return filtered


def _primitive_center_inside_cell(
    center_x: float,
    center_y: float,
    cell: TableCell,
    raster_page_width: int,
    raster_page_height: int,
) -> bool:
    x0 = (cell.x0 / max(cell.page_width, 1.0)) * raster_page_width
    y0 = (cell.y0 / max(cell.page_height, 1.0)) * raster_page_height
    x1 = (cell.x1 / max(cell.page_width, 1.0)) * raster_page_width
    y1 = (cell.y1 / max(cell.page_height, 1.0)) * raster_page_height
    return x0 <= center_x <= x1 and y0 <= center_y <= y1


def _cell_intersection_over_union(first: TableCell, second: TableCell) -> float:
    x_left = max(first.x0, second.x0)
    y_top = max(first.y0, second.y0)
    x_right = min(first.x1, second.x1)
    y_bottom = min(first.y1, second.y1)

    if x_right <= x_left or y_bottom <= y_top:
        return 0.0

    intersection = (x_right - x_left) * (y_bottom - y_top)
    first_area = (first.x1 - first.x0) * (first.y1 - first.y0)
    second_area = (second.x1 - second.x0) * (second.y1 - second.y0)
    return intersection / max(first_area + second_area - intersection, 1.0)


def _num(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _validate_pdf(pdf_bytes: bytes) -> None:
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        if len(reader.pages) == 0:
            raise ValueError("PDF does not contain any pages.")
    except PdfReadError:
        raise
    except Exception as exc:
        raise ValueError("Malformed or corrupted PDF stream.") from exc


def _detect_primitives(
    binary: np.ndarray,
    page_number: int,
    page_width: int,
    page_height: int,
) -> list[Primitive]:
    line_primitives = _detect_write_in_lines(binary, page_number, page_width, page_height)
    square_primitives = _detect_square_contours(binary, page_number, page_width, page_height)
    return _dedupe_primitives([*line_primitives, *square_primitives])


def _detect_write_in_lines(
    binary: np.ndarray,
    page_number: int,
    page_width: int,
    page_height: int,
) -> list[Primitive]:
    horizontal_width = max(25, page_width // 18)
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (horizontal_width, 1))
    isolated = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel, iterations=1)
    contours, _ = cv2.findContours(isolated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    primitives: list[Primitive] = []
    for contour in contours:
        x, y, width, height = cv2.boundingRect(contour)
        if width < page_width * 0.08 or height > max(8, page_height * 0.012):
            continue
        if width / max(height, 1) < 12:
            continue

        field_height = max(16, int(page_height * 0.018))
        primitives.append(
            Primitive(
                kind="line",
                page_number=page_number,
                x=x,
                y=max(0, y - field_height + 4),
                width=width,
                height=field_height,
            )
        )

    return primitives


def _detect_square_contours(
    binary: np.ndarray,
    page_number: int,
    page_width: int,
    page_height: int,
) -> list[Primitive]:
    square_size = max(3, min(page_width, page_height) // 180)
    square_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (square_size, square_size))
    closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, square_kernel, iterations=1)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    primitives: list[Primitive] = []
    for contour in contours:
        x, y, width, height = cv2.boundingRect(contour)
        area = cv2.contourArea(contour)
        aspect_ratio = width / max(height, 1)

        if not 0.75 <= aspect_ratio <= 1.25:
            continue
        if width < 8 or height < 8:
            continue
        if width > page_width * 0.05 or height > page_height * 0.05:
            continue
        if area < (width * height) * 0.25:
            continue

        primitives.append(Primitive("square", page_number, x, y, width, height))

    return primitives


def _dedupe_primitives(primitives: list[Primitive]) -> list[Primitive]:
    sorted_primitives = sorted(primitives, key=lambda item: (item.page_number, item.y, item.x, item.kind))
    unique: list[Primitive] = []

    for primitive in sorted_primitives:
        if any(_intersection_over_union(primitive, existing) > 0.55 for existing in unique):
            continue
        unique.append(primitive)

    return unique


def _extract_ocr_words(image: Any) -> list[OcrWord]:
    try:
        data = pytesseract.image_to_data(image, output_type=Output.DICT)
    except Exception:
        return []

    words: list[OcrWord] = []

    for index, raw_text in enumerate(data.get("text", [])):
        text = re.sub(r"\s+", " ", raw_text or "").strip()
        if not text:
            continue

        try:
            confidence = float(data["conf"][index])
        except (KeyError, TypeError, ValueError):
            confidence = -1

        if confidence < 0:
            continue

        words.append(
            OcrWord(
                text=text,
                x=int(data["left"][index]),
                y=int(data["top"][index]),
                width=int(data["width"][index]),
                height=int(data["height"][index]),
            )
        )

    return words


def _find_anchor_text(primitive: Primitive, words: list[OcrWord]) -> str:
    center_x = primitive.x + primitive.width / 2
    center_y = primitive.y + primitive.height / 2
    candidates: list[tuple[float, OcrWord]] = []

    for word in words:
        word_center_x = word.x + word.width / 2
        word_center_y = word.y + word.height / 2
        word_right = word.x + word.width
        word_bottom = word.y + word.height

        is_left = word_right <= primitive.x and abs(word_center_y - center_y) <= 100
        is_above = word_bottom <= primitive.y and abs(word_center_x - center_x) <= max(100, primitive.width)

        if not is_left and not is_above:
            continue

        distance = math.hypot(center_x - word_center_x, center_y - word_center_y)
        if distance <= 100:
            candidates.append((distance, word))

    if not candidates:
        return ""

    nearest = [word for _, word in sorted(candidates, key=lambda item: item[0])[:4]]
    ordered = sorted(nearest, key=lambda word: (word.y, word.x))
    return " ".join(word.text for word in ordered)


def _infer_field_type(primitive: Primitive, anchor_text: str) -> str:
    anchor = anchor_text.lower()

    if any(token in anchor for token in ("date", "dob", "year", "month", "day")):
        return "date"
    if primitive.kind == "square" and any(token in anchor for token in ("yes", "no", "male", "female", "[ ]")):
        return "checkbox"
    if any(token in anchor for token in ("signature", "sign", "initials")):
        return "signature"
    if primitive.kind == "square":
        return "checkbox"
    return "text"


def _normalize_geometry(primitive: Primitive, page_width: int, page_height: int) -> dict[str, float]:
    x = _clamp(primitive.x / page_width)
    y = _clamp(primitive.y / page_height)
    width = _clamp(primitive.width / page_width)
    height = _clamp(primitive.height / page_height)

    return {
        "x": float(x),
        "y": float(y),
        "width": float(min(width, 1.0 - x)),
        "height": float(min(height, 1.0 - y)),
    }


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _intersection_over_union(first: Primitive, second: Primitive) -> float:
    x_left = max(first.x, second.x)
    y_top = max(first.y, second.y)
    x_right = min(first.x + first.width, second.x + second.width)
    y_bottom = min(first.y + first.height, second.y + second.height)

    if x_right <= x_left or y_bottom <= y_top:
        return 0.0

    intersection = (x_right - x_left) * (y_bottom - y_top)
    first_area = first.width * first.height
    second_area = second.width * second.height
    return intersection / max(first_area + second_area - intersection, 1)
