FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py prompts.py ./
COPY static/ ./static/

ENV PORT=7860
EXPOSE 7860

CMD ["python", "server.py"]
