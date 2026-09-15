# Trends ML Data

Small BFF + React UI for collecting Trends alerts, labeling them, and exporting datasets for ML training.

The browser never sees `CENTRAL_BRAIN_INTERNAL_API_KEY`. The FastAPI BFF holds credentials and proxies Central Brain `/internal` APIs.

## Setup

1. Copy env and fill Central Brain values:

```bash
copy .env.example .env
```

2. Backend:

```bash
cd backend
python -m pip install -r requirements.txt
python run.py
```

BFF: [http://172.22.225.176:8080](http://172.22.225.176:8080) · docs at `/docs`

3. Frontend:

```bash
cd frontend
npm install
npm run dev
```

UI: [http://172.22.225.176:3210](http://172.22.225.176:3210)

## Flow

1. **Home** — connection health + dataset stats
2. **New rule** — pick category, query text or image, optional cameras
3. **Collect** — rule + time window, preview counts, cache alerts/images
4. **Label** — J / K / L for like / neutral / dislike
5. **Export** — download `manifest.jsonl` + images zip

## Data layout

```text
backend/data/
  images/{alert_id}.jpg
  manifest.jsonl
```

## Notes

- Uses `ALERT_RULE_TYPE` (default `test`; this Central Brain enum is `user` | `wordmap` | `test`)
- Alert lists require one rule ID and inclusive `from_timestamp` / `to_timestamp`
- Images are fetched from the opaque `image_path` URL (no API key) and served to the UI via `/api/media/{alert_id}`
