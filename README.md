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

1. **Home** — connection health + one card per training window
2. **New rule** — pick category, query text or image, optional cameras
3. **Collect** — one rule + time window; that pair becomes one dataset
4. **Label** — label only that window (J / K / L for like / neutral / dislike)
5. **Export** — download that window as `dataset.json` + `manifest.jsonl` + images

Do not mix rules or time windows. Each zip is one class/query and one timestamp range for ML training.

## Data layout

```text
backend/data/
  images/{alert_id}.jpg
  manifest.jsonl
  datasets.jsonl
```

## Notes

- Uses `ALERT_RULE_TYPE` (default `test`; this Central Brain enum is `user` | `wordmap` | `test`)
- Alert lists require one rule ID and inclusive `from_timestamp` / `to_timestamp`
- Images are fetched from the opaque `image_path` URL (no API key) and served to the UI via `/api/media/{alert_id}`
- Internal media HTTPS often uses a self-signed cert; `SSL_VERIFY=false` (default) lets the BFF cache those frames
