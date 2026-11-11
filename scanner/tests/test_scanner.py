from __future__ import annotations

import io
import time
from typing import Literal

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont

from ocr_engine import dehyphenate_join, looks_like_structural_page_fast
from server import create_app
from session_manager import SessionManager, format_chapter_pages
from models import HighlightItem
from sticky_detector import detect_stickies, split_spread


PAGE_W = 820
PAGE_H = 1140

# RGBA translucent sticky palette (neon + pastel colors)
STICKY_COLORS: dict[str, tuple[int, int, int, int]] = {
    "neon_yellow": (255, 244, 79, 185),
    "neon_pink": (255, 105, 180, 180),
    "neon_blue": (70, 190, 255, 180),
    "neon_green": (110, 245, 130, 180),
    "orange": (255, 165, 65, 185),
    "pastel_lavender": (205, 175, 255, 190),
    "pastel_mint": (165, 242, 205, 195),
}


def _get_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size=size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def _pil_to_bgr_and_jpeg(img: Image.Image) -> tuple[np.ndarray, bytes]:
    rgb = np.array(img.convert("RGB"), dtype=np.uint8)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=93)
    return bgr, buf.getvalue()


def render_synthetic_page(
    *,
    paragraphs: list[list[str]],
    page_number: int | None = None,
    chapter_title: str | None = None,
    toc_title: str | None = None,
    toc_rows: list[tuple[str, int]] | None = None,
    stickies: list[dict] | None = None,
    paper_rgb: tuple[int, int, int] = (250, 248, 242),
    top_sink_y: int | None = None,
) -> tuple[np.ndarray, bytes, list[tuple[int, int]]]:
    """Render a realistic synthetic book page in RAM (zero disk writes).

    Returns `(bgr, jpeg_bytes, paragraph_y_spans)` where `paragraph_y_spans[i]`
    is `(y_top, y_bottom)` in pixels for `paragraphs[i]`.
    """
    base = Image.new("RGBA", (PAGE_W, PAGE_H), (*paper_rgb, 255))
    draw = ImageDraw.Draw(base)

    body_font = _get_font(23)
    title_font = _get_font(36)
    footer_font = _get_font(21)

    y_cursor = top_sink_y if top_sink_y is not None else 135
    left_x = 115

    if toc_title:
        draw.text((left_x, 140), toc_title, fill=(22, 22, 22, 255), font=title_font)
        y_cursor = 230
        for row_label, row_page in toc_rows or []:
            draw.text((left_x, y_cursor), row_label, fill=(28, 28, 28, 255), font=body_font)
            draw.text(
                (PAGE_W - 155, y_cursor),
                str(row_page),
                fill=(28, 28, 28, 255),
                font=body_font,
            )
            y_cursor += 48

    if chapter_title:
        if top_sink_y is None:
            y_cursor = 240
        draw.text((left_x, y_cursor), chapter_title, fill=(18, 18, 18, 255), font=title_font)
        y_cursor += 92

    para_spans: list[tuple[int, int]] = []
    line_step = 34
    para_gap = 40

    for para_lines in paragraphs:
        p_top = y_cursor
        for ln in para_lines:
            draw.text((left_x, y_cursor), ln, fill=(26, 26, 26, 255), font=body_font)
            y_cursor += line_step
        p_bot = y_cursor - (line_step - 24)
        para_spans.append((p_top, p_bot))
        y_cursor += para_gap

    if page_number is not None:
        draw.text(
            (PAGE_W // 2 - 16, PAGE_H - 78),
            str(page_number),
            fill=(40, 40, 40, 255),
            font=footer_font,
        )

    # Overlay translucent colored sticky strips (simulating physical sticky flags).
    for st in stickies or []:
        overlay = Image.new("RGBA", (PAGE_W, PAGE_H), (0, 0, 0, 0))
        odraw = ImageDraw.Draw(overlay)
        rgba = STICKY_COLORS.get(st.get("color", "neon_yellow"), STICKY_COLORS["neon_yellow"])
        kind: Literal["L", "bar"] = st["kind"]
        y_anchor = int(st["y"])
        side: Literal["left", "right"] = st.get("side", "left")
        thick = int(st.get("thick", 18))
        arm_w = int(st.get("arm_w", 96))
        arm_h = int(st.get("arm_h", 92))

        if kind == "bar":
            x0 = 36 if side == "left" else PAGE_W - 36 - arm_w
            odraw.rectangle(
                [x0, y_anchor - thick // 2, x0 + arm_w, y_anchor + thick // 2],
                fill=rgba,
            )
        elif kind == "L":
            direction: Literal["down", "up"] = st.get("direction", "down")
            gap_px = int(st.get("gap", 0))
            if side == "left":
                hx0, hx1 = 38, 38 + arm_w
                vx0, vx1 = 38, 38 + thick
            else:
                hx0, hx1 = PAGE_W - 38 - arm_w, PAGE_W - 38
                vx0, vx1 = PAGE_W - 38 - thick, PAGE_W - 38

            hy0, hy1 = y_anchor - thick // 2, y_anchor + thick // 2
            odraw.rectangle([hx0, hy0, hx1, hy1], fill=rgba)

            if direction == "down":
                vy0 = hy0 + gap_px
                vy1 = vy0 + arm_h
            else:
                vy1 = hy1 - gap_px
                vy0 = vy1 - arm_h
            odraw.rectangle([vx0, vy0, vx1, vy1], fill=rgba)

        base = Image.alpha_composite(base, overlay)

    bgr, jpeg_bytes = _pil_to_bgr_and_jpeg(base)
    return bgr, jpeg_bytes, para_spans


def _dense_unmarked_paragraphs(seed_word: str) -> list[list[str]]:
    """Generate a full 4-paragraph unmarked prose page spanning top-to-bottom body margins."""
    return [
        [
            f"En el estudio moderno sobre {seed_word} observamos cambios constantes",
            "que transforman la experiencia cotidiana de todas las comunidades",
            "urbanas y rurales mediante sistemas complejos de comunicacion",
            "abierta entre lectores investigadores y ciudadanos curiosos.",
        ],
        [
            "Cada observacion rigurosa permite comprender mejor los habitos",
            "de lectura profunda frente al ruido constante de las pantallas",
            "contemporaneas cuando buscamos claridad conceptual duradera",
            "en obras clasicas de historia filosofia y ciencia aplicada.",
        ],
        [
            "Por consiguiente conviene examinar con paciencia cada argumento",
            "expuesto por los autores antes de formular conclusiones rapidas",
            "sobre fenomenos culturales economicos o tecnologicos actuales",
            "que todavia siguen evolucionando dia tras dia en el mundo.",
        ],
        [
            "Finalmente la practica deliberada de subrayar ideas esenciales",
            "consolida la memoria de largo plazo y facilita conectar textos",
            "distantes dentro de una misma biblioteca personal ordenada",
            "para futuras consultas y proyectos de escritura creativa.",
        ],
    ]


class TestStickyDetectorAndStage1:
    def test_detects_L_up_and_down_left_and_right_all_colors(self) -> None:
        paras = [
            [
                "Primer parrafo de prueba sobre meditacion estoica diaria",
                "practicada con atencion serena al comenzar la manana",
                "antes de emprender las tareas habituales de la jornada.",
            ],
            [
                "Segundo parrafo independiente acerca del valor de la templanza",
                "cuando surgen dificultades imprevistas en la vida publica",
                "y debemos responder con prudencia y ecuanimidad firme.",
            ],
            [
                "Tercer parrafo enfocado en la disciplina de la percepcion clara",
                "observando los hechos desnudos sin anadir juicios apresurados",
                "que nublen el entendimiento racional de cada circunstancia.",
            ],
            [
                "Cuarto parrafo final en la zona inferior de la pagina impresa",
                "recordando la brevedad del instante presente y la gratitud",
                "por el aprendizaje compartido con quienes nos rodean.",
            ],
        ]
        # Place 4 L-stickies covering all 4 geometric orientations & distinct colors:
        # 1) Left + Down (neon yellow)
        # 2) Right + Down (neon pink)
        # 3) Left + Up (pastel lavender, slightly gapped by 4px)
        # 4) Right + Up (neon blue)
        _, _, spans = render_synthetic_page(paragraphs=paras, page_number=14)
        stickies = [
            {"kind": "L", "y": spans[0][0] + 10, "side": "left", "direction": "down", "color": "neon_yellow"},
            {"kind": "L", "y": spans[1][0] + 10, "side": "right", "direction": "down", "color": "neon_pink"},
            {"kind": "L", "y": spans[2][0] + 10, "side": "left", "direction": "up", "color": "pastel_lavender", "gap": 4},
            {"kind": "L", "y": spans[3][0] + 10, "side": "right", "direction": "up", "color": "neon_blue"},
        ]
        bgr, _, _ = render_synthetic_page(paragraphs=paras, page_number=14, stickies=stickies)

        detected = detect_stickies(bgr)
        assert len(detected) == 4
        assert [m.kind for m in detected] == ["L", "L", "L", "L"]

        # Verify every L's yNorm tracks its HORIZONTAL line (even when vertical goes UP!)
        for idx, marker in enumerate(detected):
            expected_y_norm = (spans[idx][0] + 10) / PAGE_H
            assert abs(marker.yNorm - expected_y_norm) < 0.025

    def test_detects_two_horizontal_bars_sorted_top_to_bottom(self) -> None:
        paras = _dense_unmarked_paragraphs("arquitectura")
        _, _, spans = render_synthetic_page(paragraphs=paras, page_number=31)
        stickies = [
            {"kind": "bar", "y": spans[2][1], "side": "right", "color": "orange"},
            {"kind": "bar", "y": spans[1][0] + 8, "side": "left", "color": "pastel_mint"},
        ]
        bgr, _, _ = render_synthetic_page(paragraphs=paras, page_number=31, stickies=stickies)

        detected = detect_stickies(bgr)
        assert len(detected) == 2
        assert [m.kind for m in detected] == ["bar", "bar"]
        assert detected[0].yNorm < detected[1].yNorm

    def test_stage1_skips_plain_unmarked_body_page_fast(self) -> None:
        bgr, _, _ = render_synthetic_page(
            paragraphs=_dense_unmarked_paragraphs("astronomia"),
            page_number=88,
        )
        t0 = time.perf_counter()
        markers = detect_stickies(bgr)
        is_structural = looks_like_structural_page_fast(bgr)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        assert markers == []
        assert is_structural is False
        assert elapsed_ms < 35.0, f"Stage 1 filter took {elapsed_ms:.1f}ms (expected < 35ms)"

    def test_spread_splitting_auto_and_double(self) -> None:
        left_bgr, _, _ = render_synthetic_page(
            paragraphs=_dense_unmarked_paragraphs("izquierda"),
            page_number=40,
        )
        right_bgr, _, _ = render_synthetic_page(
            paragraphs=_dense_unmarked_paragraphs("derecha"),
            page_number=41,
        )
        # Concatenate with a realistic dark vertical spine shadow in the center.
        spread = np.hstack([left_bgr, right_bgr])
        mid = spread.shape[1] // 2
        for dx in range(-10, 11):
            factor = 0.68 + 0.30 * (abs(dx) / 10.0)
            spread[:, mid + dx] = (spread[:, mid + dx].astype(np.float32) * factor).astype(np.uint8)

        auto_pages = split_spread(spread, spread_mode="auto")
        assert [side for side, _ in auto_pages] == ["left", "right"]

        forced_single = split_spread(spread, spread_mode="single")
        assert [side for side, _ in forced_single] == ["single"]


class TestFastApiScannerEndToEnd:
    @pytest.fixture()
    def client(self, monkeypatch: pytest.MonkeyPatch) -> TestClient:
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        monkeypatch.delenv("FIREBASE_PROJECT_ID", raising=False)
        app = create_app(SessionManager())
        return TestClient(app)

    def test_health_and_chapter_pages_formatter(self, client: TestClient) -> None:
        res = client.get("/health")
        assert res.status_code == 200
        body = res.json()
        assert body == {"ok": True, "ocrBackend": "rapidocr"}

        assert format_chapter_pages([HighlightItem(id="1", page="23", text="a", kind="L")]) == "23"
        assert (
            format_chapter_pages(
                [
                    HighlightItem(id="1", page="23", text="a", kind="L"),
                    HighlightItem(id="2", page="38", text="b", kind="L"),
                ]
            )
            == "23 y 38"
        )
        assert (
            format_chapter_pages(
                [
                    HighlightItem(id="1", page="523", text="a", kind="L"),
                    HighlightItem(id="2", page="538", text="b", kind="L"),
                    HighlightItem(id="3", page="543", text="c", kind="L"),
                ]
            )
            == "523, 538 y 543"
        )
        assert dehyphenate_join("La progra-", "mación funcional") == "La programación funcional"

    def test_full_book_walk_toc_chapters_L_bars_multipage_skip_and_duplicate(
        self, client: TestClient
    ) -> None:
        # 1. Create session
        create_res = client.post("/sessions", json={"bookTitle": "Meditaciones Selectas"})
        assert create_res.status_code == 200
        session_id = create_res.json()["sessionId"]
        assert create_res.json()["pagesScanned"] == 0

        # 2. Scan Table of Contents (Índice)
        _, toc_jpeg, _ = render_synthetic_page(
            paragraphs=[],
            toc_title="Indice",
            toc_rows=[
                ("1. El despertar de la conciencia", 10),
                ("2. La arquitectura del tiempo", 20),
                ("20. El final de Homo sapiens", 518),
            ],
            page_number=5,
        )
        toc_res = client.post(
            f"/sessions/{session_id}/frame",
            files={"frame": ("toc.jpg", toc_jpeg, "image/jpeg")},
        )
        assert toc_res.status_code == 200
        toc_data = toc_res.json()
        assert toc_data["accepted"] is True
        assert toc_data["detectedPages"][0]["action"] == "toc"

        # 3. Duplicate frame gate (resending exact same TOC frame without force=true)
        dup_res = client.post(
            f"/sessions/{session_id}/frame",
            files={"frame": ("toc_dup.jpg", toc_jpeg, "image/jpeg")},
        )
        assert dup_res.status_code == 200
        assert dup_res.json()["accepted"] is False
        assert dup_res.json()["reason"] == "duplicate"

        # Sending with force=true overrides duplicate gate
        forced_res = client.post(
            f"/sessions/{session_id}/frame",
            files={"frame": ("toc_force.jpg", toc_jpeg, "image/jpeg")},
            data={"force": "true"},
        )
        assert forced_res.status_code == 200
        assert forced_res.json()["accepted"] is True

        # 4. Blur gate: severely out-of-focus frame is rejected with reason="blurry"
        sharp_bgr, _, _ = render_synthetic_page(
            paragraphs=_dense_unmarked_paragraphs("desenfoque"),
            page_number=11,
        )
        blurred_bgr = cv2.GaussianBlur(sharp_bgr, (45, 45), 16.0)
        ok, blurred_enc = cv2.imencode(".jpg", blurred_bgr)
        assert ok
        blur_res = client.post(
            f"/sessions/{session_id}/frame",
            files={"frame": ("blur.jpg", blurred_enc.tobytes(), "image/jpeg")},
        )
        assert blur_res.status_code == 200
        assert blur_res.json()["accepted"] is False
        assert blur_res.json()["reason"] == "blurry"

        # 5. Unmarked plain body page -> fast skipped
        _, plain_jpeg, _ = render_synthetic_page(
            paragraphs=_dense_unmarked_paragraphs("silencio"),
            page_number=12,
        )
        skip_res = client.post(
            f"/sessions/{session_id}/frame",
            files={"frame": ("p12.jpg", plain_jpeg, "image/jpeg")},
        )
        assert skip_res.status_code == 200
        assert skip_res.json()["detectedPages"][0]["action"] == "skipped"
        assert skip_res.json()["snapshot"]["pagesSkipped"] >= 1

        # 6. Chapter Title page (page 20)
        _, ch_jpeg, _ = render_synthetic_page(
            paragraphs=[
                [
                    "Comienza aqui nuestra exploracion detallada acerca de como",
                    "medimos la duracion de las estaciones y de la memoria.",
                ]
            ],
            chapter_title="Capitulo 2: La arquitectura del tiempo",
            page_number=20,
        )
        ch_res = client.post(
            f"/sessions/{session_id}/frame",
            files={"frame": ("p20.jpg", ch_jpeg, "image/jpeg")},
        )
        assert ch_res.status_code == 200
        assert ch_res.json()["detectedPages"][0]["action"] == "chapter-start"
        assert "arquitectura del tiempo" in ch_res.json()["snapshot"]["currentChapter"].lower()

        # 7. Single-paragraph L highlight (UP direction on right margin, page 21)
        p21_paras = [
            [
                "Este primer bloque introductorio solamente contextualiza",
                "los antecedentes antiguos sin constituir la cita elegida.",
            ],
            [
                "La verdadera sabiduria consiste en distinguir con serenidad",
                "aquello que depende de nuestra voluntad cotidiana.",
            ],
            [
                "Un tercer comentario posterior que tampoco debe mezclarse",
                "con la meditacion central marcada por el lector.",
            ],
        ]
        _, _, p21_spans = render_synthetic_page(paragraphs=p21_paras, page_number=21)
        _, p21_jpeg, _ = render_synthetic_page(
            paragraphs=p21_paras,
            page_number=21,
            stickies=[
                {
                    "kind": "L",
                    "y": p21_spans[1][0] + 12,
                    "side": "right",
                    "direction": "up",
                    "color": "neon_pink",
                }
            ],
        )
        p21_res = client.post(
            f"/sessions/{session_id}/frame",
            files={"frame": ("p21.jpg", p21_jpeg, "image/jpeg")},
        )
        assert p21_res.status_code == 200
        p21_json = p21_res.json()
        assert p21_json["detectedPages"][0]["action"] == "highlight-L"
        assert p21_json["detectedPages"][0]["extractedCount"] == 1
        hl_l = p21_json["snapshot"]["chapters"][0]["highlights"][0]
        assert hl_l["kind"] == "L"
        assert hl_l["page"] == "21"
        assert "verdadera sabiduria" in hl_l["text"].lower()
        assert "primer bloque" not in hl_l["text"].lower()
        assert "tercer comentario" not in hl_l["text"].lower()

        # 8. Two horizontal bars on same page (intra-page range on page 22)
        p22_paras = [
            ["Parrafo superior fuera del rango seleccionado en esta hoja."],
            [
                "Inicio del pasaje destacado mediante dos barras horizontales",
                "colocadas cuidadosamente al principio y al cierre.",
            ],
            [
                "Segundo parrafo incluido tambien dentro del mismo intervalo",
                "intra pagina para conservar toda la idea completa.",
            ],
            ["Parrafo inferior excluido debajo de la segunda barra."],
        ]
        _, _, p22_spans = render_synthetic_page(paragraphs=p22_paras, page_number=22)
        _, p22_jpeg, _ = render_synthetic_page(
            paragraphs=p22_paras,
            page_number=22,
            stickies=[
                {"kind": "bar", "y": p22_spans[1][0] + 10, "side": "left", "color": "neon_yellow"},
                {"kind": "bar", "y": p22_spans[2][1] - 4, "side": "left", "color": "neon_yellow"},
            ],
        )
        p22_res = client.post(
            f"/sessions/{session_id}/frame",
            files={"frame": ("p22.jpg", p22_jpeg, "image/jpeg")},
        )
        assert p22_res.status_code == 200
        p22_json = p22_res.json()
        assert p22_json["detectedPages"][0]["action"] == "range-close"
        assert p22_json["snapshot"]["openRange"]["active"] is False
        hl_intra = p22_json["snapshot"]["chapters"][0]["highlights"][1]
        assert hl_intra["kind"] == "range"
        assert hl_intra["page"] == "22"
        assert "inicio del pasaje" in hl_intra["text"].lower()
        assert "segundo parrafo incluido" in hl_intra["text"].lower()
        assert "superior fuera" not in hl_intra["text"].lower()
        assert "inferior excluido" not in hl_intra["text"].lower()

        # 9. Multi-page range 23 -> 24 -> 25 (with cross-page hyphenation!)
        p23_paras = [
            ["Texto previo en la parte alta de la pagina veintitres."],
            [
                "Aqui comienza una reflexion extensa sobre la progra-",
            ],
        ]
        _, _, p23_spans = render_synthetic_page(paragraphs=p23_paras, page_number=23)
        _, p23_jpeg, _ = render_synthetic_page(
            paragraphs=p23_paras,
            page_number=23,
            stickies=[
                {"kind": "bar", "y": p23_spans[1][0] + 10, "side": "left", "color": "neon_green"},
            ],
        )
        p23_res = client.post(
            f"/sessions/{session_id}/frame",
            files={"frame": ("p23.jpg", p23_jpeg, "image/jpeg")},
        )
        assert p23_res.status_code == 200
        assert p23_res.json()["detectedPages"][0]["action"] == "range-open"
        assert p23_res.json()["snapshot"]["openRange"]["active"] is True
        assert p23_res.json()["snapshot"]["openRange"]["startPage"] == 23

        # Page 24: 0 bars while open_range is active -> full-page continuation
        p24_paras = [
            [
                "macion estructurada como disciplina mental rigurosa que",
                "conecta la pagina veinticuatro entera sin interrupcion",
            ]
        ]
        _, p24_jpeg, _ = render_synthetic_page(paragraphs=p24_paras, page_number=24)
        p24_res = client.post(
            f"/sessions/{session_id}/frame",
            files={"frame": ("p24.jpg", p24_jpeg, "image/jpeg")},
        )
        assert p24_res.status_code == 200
        assert p24_res.json()["detectedPages"][0]["action"] == "range-continue"
        assert p24_res.json()["snapshot"]["openRange"]["active"] is True
        assert p24_res.json()["snapshot"]["openRange"]["lastPage"] == 24

        # Page 25: 1 bar closes the open range -> "23–25"
        p25_paras = [
            [
                "hasta culminar limpiamente en la pagina veinticinco.",
            ],
            ["Parrafo posterior fuera del cierre en la pagina veinticinco."],
        ]
        _, _, p25_spans = render_synthetic_page(paragraphs=p25_paras, page_number=25)
        _, p25_jpeg, _ = render_synthetic_page(
            paragraphs=p25_paras,
            page_number=25,
            stickies=[
                {"kind": "bar", "y": p25_spans[0][1] - 4, "side": "right", "color": "neon_green"},
            ],
        )
        p25_res = client.post(
            f"/sessions/{session_id}/frame",
            files={"frame": ("p25.jpg", p25_jpeg, "image/jpeg")},
        )
        assert p25_res.status_code == 200
        p25_json = p25_res.json()
        assert p25_json["detectedPages"][0]["action"] == "range-close"
        assert p25_json["snapshot"]["openRange"]["active"] is False

        hl_multi = p25_json["snapshot"]["chapters"][0]["highlights"][2]
        assert hl_multi["kind"] == "range"
        assert hl_multi["page"] == "23–25"
        assert "programacion" in hl_multi["text"].lower()
        assert "veinticuatro entera" in hl_multi["text"].lower()
        assert "veinticinco" in hl_multi["text"].lower()
        assert "posterior fuera" not in hl_multi["text"].lower()
        assert p25_json["snapshot"]["chapters"][0]["pages"] == "21, 22 y 23–25"

    def test_skipped_page_warning_23_to_26_and_finish_and_delete(
        self, client: TestClient
    ) -> None:
        session_id = client.post("/sessions", json={"bookTitle": "Sapiens"}).json()["sessionId"]

        # Open range on page 23
        p23_paras = [["Inicio de un rango abierto en la pagina veintitres."]]
        _, _, p23_spans = render_synthetic_page(paragraphs=p23_paras, page_number=23)
        _, p23_jpeg, _ = render_synthetic_page(
            paragraphs=p23_paras,
            page_number=23,
            stickies=[{"kind": "bar", "y": p23_spans[0][0] + 10, "side": "left", "color": "neon_blue"}],
        )
        r23 = client.post(
            f"/sessions/{session_id}/frame",
            files={"frame": ("p23.jpg", p23_jpeg, "image/jpeg")},
        )
        assert r23.json()["detectedPages"][0]["action"] == "range-open"

        # Jump directly to page 26 (skipping 24–25!)
        p26_paras = [["Continuacion en la pagina veintiseis tras saltar dos hojas."]]
        _, p26_jpeg, _ = render_synthetic_page(paragraphs=p26_paras, page_number=26)
        r26 = client.post(
            f"/sessions/{session_id}/frame",
            files={"frame": ("p26.jpg", p26_jpeg, "image/jpeg")},
        )
        snap = r26.json()["snapshot"]
        assert "Faltan las páginas 24–25 del rango abierto en pág. 23" in snap["warnings"]

        # Finish flushes still-open range into highlights
        fin = client.post(f"/sessions/{session_id}/finish")
        assert fin.status_code == 200
        fin_snap = fin.json()["snapshot"]
        assert fin_snap["openRange"]["active"] is False
        assert len(fin_snap["chapters"]) == 1
        assert fin_snap["chapters"][0]["highlights"][0]["page"] == "23–26"

        # Delete removes session from RAM
        del_res = client.delete(f"/sessions/{session_id}")
        assert del_res.status_code == 200
        assert del_res.json() == {"deleted": True}

        missing = client.post(f"/sessions/{session_id}/finish")
        assert missing.status_code == 404

    def test_auth_enforced_when_firebase_project_id_configured(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("FIREBASE_PROJECT_ID", "demo-book-project")
        monkeypatch.delenv("ALLOW_DEV_UNAUTH", raising=False)
        secured_client = TestClient(create_app(SessionManager()))

        # /health stays public
        assert secured_client.get("/health").status_code == 200

        # /sessions rejects unauthenticated calls with 401
        unauth = secured_client.post("/sessions", json={})
        assert unauth.status_code == 401

    def test_rs256_firebase_jwt_valid_and_invalid_audience(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import auth
        import jwt
        from cryptography.hazmat.primitives.asymmetric import rsa

        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        public_key = private_key.public_key()

        class _StubSigningKey:
            def __init__(self, key):
                self.key = key

        class _StubJwkClient:
            def get_signing_key_from_jwt(self, _token: str) -> _StubSigningKey:
                return _StubSigningKey(public_key)

        monkeypatch.setenv("FIREBASE_PROJECT_ID", "book-hl-prod")
        monkeypatch.setenv("ALLOW_DEV_UNAUTH", "0")
        monkeypatch.setattr(auth, "_get_jwk_client", lambda: _StubJwkClient())

        secured_client = TestClient(create_app(SessionManager()))
        now = int(time.time())

        valid_token = jwt.encode(
            {
                "iss": "https://securetoken.google.com/book-hl-prod",
                "aud": "book-hl-prod",
                "sub": "user-juan-123",
                "iat": now - 10,
                "exp": now + 600,
            },
            private_key,
            algorithm="RS256",
        )
        ok_res = secured_client.post(
            "/sessions",
            json={"bookTitle": "Ficciones"},
            headers={"Authorization": f"Bearer {valid_token}"},
        )
        assert ok_res.status_code == 200

        wrong_aud_token = jwt.encode(
            {
                "iss": "https://securetoken.google.com/other-proj",
                "aud": "other-proj",
                "sub": "user-juan-123",
                "iat": now - 10,
                "exp": now + 600,
            },
            private_key,
            algorithm="RS256",
        )
        bad_res = secured_client.post(
            "/sessions",
            json={},
            headers={"Authorization": f"Bearer {wrong_aud_token}"},
        )
        assert bad_res.status_code == 401

    def test_gemini_hybrid_backend_and_automatic_rapidocr_fallback(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("GEMINI_API_KEY", "fake-key-that-triggers-fallback")
        monkeypatch.setenv("OCR_BACKEND", "hybrid")
        monkeypatch.delenv("FIREBASE_PROJECT_ID", raising=False)

        manager = SessionManager()

        def _failing_gemini(*_args, **_kwargs):
            raise RuntimeError("Simulated Gemini quota/network outage")

        monkeypatch.setattr(manager.ocr_engine, "_analyze_with_gemini", _failing_gemini)
        hybrid_client = TestClient(create_app(manager))

        health = hybrid_client.get("/health").json()
        assert health == {"ok": True, "ocrBackend": "hybrid"}

        sid = hybrid_client.post("/sessions", json={"bookTitle": "Ensayos"}).json()["sessionId"]
        paras = [
            ["Primer parrafo sin marcar en la parte superior."],
            ["Segundo parrafo rescatado automaticamente por RapidOCR local."],
        ]
        _, _, spans = render_synthetic_page(paragraphs=paras, page_number=77)
        _, jpg, _ = render_synthetic_page(
            paragraphs=paras,
            page_number=77,
            stickies=[{"kind": "L", "y": spans[1][0] + 10, "side": "left", "direction": "down", "color": "orange"}],
        )
        scan = hybrid_client.post(
            f"/sessions/{sid}/frame",
            files={"frame": ("p77.jpg", jpg, "image/jpeg")},
        )
        assert scan.status_code == 200
        data = scan.json()
        assert data["detectedPages"][0]["action"] == "highlight-L"
        assert "rapidocr local" in data["snapshot"]["chapters"][0]["highlights"][0]["text"].lower()

    def test_double_spread_scan_and_session_eviction_and_tilted_L(
        self, client: TestClient
    ) -> None:
        # 1. Tilted L-sticky (~9 deg camera rotation) still detected as kind == 'L'
        paras = _dense_unmarked_paragraphs("rotacion")
        _, _, spans = render_synthetic_page(paragraphs=paras, page_number=50)
        bgr, _, _ = render_synthetic_page(
            paragraphs=paras,
            page_number=50,
            stickies=[{"kind": "L", "y": spans[1][0] + 10, "side": "left", "direction": "down", "color": "neon_yellow"}],
        )
        center = (PAGE_W * 0.5, PAGE_H * 0.5)
        rot_mat = cv2.getRotationMatrix2D(center, 8.0, 1.0)
        tilted = cv2.warpAffine(bgr, rot_mat, (PAGE_W, PAGE_H), borderValue=(250, 248, 242))
        tilted_markers = detect_stickies(tilted)
        assert len(tilted_markers) == 1
        assert tilted_markers[0].kind == "L"

        # 2. End-to-end double-page spread scan (pages 523 and 538/524)
        sid = client.post("/sessions", json={"bookTitle": "Homo Deus"}).json()["sessionId"]
        left_p = [["Idea clave destacada en la pagina izquierda del libro abierto."]]
        _, _, l_spans = render_synthetic_page(paragraphs=left_p, page_number=523)
        left_bgr, _, _ = render_synthetic_page(
            paragraphs=left_p,
            page_number=523,
            stickies=[{"kind": "L", "y": l_spans[0][0] + 10, "side": "left", "direction": "down", "color": "pastel_mint"}],
        )
        right_p = [["Idea complementaria marcada en la pagina derecha del pliego."]]
        _, _, r_spans = render_synthetic_page(paragraphs=right_p, page_number=524)
        right_bgr, _, _ = render_synthetic_page(
            paragraphs=right_p,
            page_number=524,
            stickies=[{"kind": "L", "y": r_spans[0][0] + 10, "side": "right", "direction": "up", "color": "orange"}],
        )
        spread = np.hstack([left_bgr, right_bgr])
        mid = spread.shape[1] // 2
        spread[:, mid - 4 : mid + 4] = (spread[:, mid - 4 : mid + 4] * 0.72).astype(np.uint8)
        ok, spread_enc = cv2.imencode(".jpg", spread)
        assert ok

        res = client.post(
            f"/sessions/{sid}/frame",
            files={"frame": ("spread.jpg", spread_enc.tobytes(), "image/jpeg")},
            data={"spreadMode": "auto"},
        )
        assert res.status_code == 200
        rjson = res.json()
        assert [p["side"] for p in rjson["detectedPages"]] == ["left", "right"]
        assert [p["pageNumber"] for p in rjson["detectedPages"]] == [523, 524]
        assert rjson["snapshot"]["chapters"][0]["pages"] == "523 y 524"

        # 3. Max concurrent sessions cap & TTL expiry
        tiny_mgr = SessionManager(ttl_seconds=0.05, max_sessions=3)
        s1 = tiny_mgr.create_session("B1").sessionId
        s2 = tiny_mgr.create_session("B2").sessionId
        s3 = tiny_mgr.create_session("B3").sessionId
        s4 = tiny_mgr.create_session("B4").sessionId
        # s1 evicted by max_sessions=3
        assert tiny_mgr.get_session(s1) is None
        assert tiny_mgr.get_session(s4) is not None
        time.sleep(0.07)
        assert tiny_mgr.get_session(s2) is None
        assert tiny_mgr.get_session(s3) is None
        assert tiny_mgr.get_session(s4) is None

