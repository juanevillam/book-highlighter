FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && pip uninstall -y opencv-python || true \
    && pip install --no-cache-dir --force-reinstall --no-deps opencv-python-headless

COPY auth.py models.py ocr_engine.py server.py session_manager.py sticky_detector.py ./

# Warm RapidOCR ONNX models at build/import check time without touching runtime storage
RUN python -c "import cv2; from rapidocr_onnxruntime import RapidOCR; RapidOCR()"

EXPOSE 8080

CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080}"]
