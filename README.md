# YouCam Live VTO — Real-Time Clothes Try-On on Webcam

Live video rendering of clothes on a person through their webcam, powered by **Perfect Corp YouCam API (Clothes V4)**. Turn on your camera, upload a garment photo, and YouCam AI renders the clothes on you live — like the Anywear demo.

Built for the **YouCam API Skin AI & eCommerce VTO Hackathon** (Devpost, deadline Nov 2, 2026).

## How it works (live video)

1. **Start camera** — See yourself live on webcam (selfie mode, mirrored)
2. **Upload garment** — Select a shirt/product photo (e.g., your striped polo)
3. **YouCam AI renders live** — The app captures webcam frames every 3 seconds, sends them to YouCam `cloth-v4` API, and displays the photorealistic try-on result on your body as each frame completes
4. **Results update continuously** — As you move, new frames are processed and the rendered garment follows you

## YouCam API workflow (all server-side, API key never exposed)

| Step | Endpoint | Purpose |
|------|----------|---------|
| Upload | `POST /s2s/v2.0/file` | Register image, get presigned URL + `file_id` |
| Try-on | `POST /s2s/v2.0/task/cloth-v4` | Start AI try-on task (selfie frame + garment) |
| Poll | `GET /s2s/v2.0/task/cloth-v4/{taskId}` | Wait for result (~10-30s per frame) |
| Result | Download URL from task response | Photorealistic try-on image on your body |

## ⚠️ Important: YouCam API is async, not real-time streaming

YouCam `cloth-v4` processes images asynchronously — each frame takes ~10-30 seconds. This app creates a **live video feel** by:
- Capturing webcam frames every 3 seconds
- Sending each frame to YouCam AI
- Displaying results as they complete

This is the closest possible experience to real-time using YouCam's API.

## Quick start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env.local
# Add your YouCam API key to .env.local

# Run dev server
npm run dev

# Open http://localhost:3000
```

## Deploy to Vercel

1. Push this repo to GitHub
2. Connect the repo to Vercel: https://vercel.com/new
3. Add `YOUCAM_API_KEY` in Vercel project settings → Environment Variables
4. Deploy — Vercel auto-detects Next.js 15

## Get your free YouCam API key (mandatory for hackathon)

1. Sign up at: https://yce.makeupar.com/ai-api (India: https://yce.makeupar.com/ai-api)
2. Redeem free 1,000 API units (code emailed after Devpost registration)
3. Generate key at: https://yce.makeupar.com/api-console/en/api-keys/

## Tech stack

- Next.js 15 (App Router)
- React 19 + TypeScript
- Tailwind CSS
- Perfect Corp YouCam API (Clothes V4)
- Webcam API (getUserMedia)

## Hackathon submission (tonight's deadline)

1. **Get your API key** and deploy to Vercel
2. **Record 1–3 min demo:** webcam live → upload striped polo → YouCam AI renders garment on your body
3. **Upload to YouTube**
4. **Submit on Devpost:** https://youcam-api-skin-ai-ecommerce.devpost.com/
   - Repo URL: https://github.com/swathigampa354-ship-it/youcam-vto-app
   - Include screenshots, description, and YouTube video link

**Deadline: Nov 2, 2026, 11:45am EST (~10:15 PM IST tonight)**

## Files in the repo

- `app/page.tsx` — Live webcam try-on UI: camera, garment upload, live frame rendering, results
- `app/api/upload/route.ts` — YouCam file upload proxy (server-side)
- `app/api/tryon/route.ts` — YouCam cloth-v4 task creation (server-side)
- `app/api/task/[taskId]/route.ts` — YouCam task status polling (server-side)
- `lib/youcam.ts` — YouCam API client (all server-side, key never exposed)
- `.env.example` — API key configuration
