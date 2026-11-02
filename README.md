# YouCam VTO — Live Clothes Virtual Try-On

Photorealistic virtual try-on powered by **Perfect Corp YouCam API (Clothes V4)**. Upload a selfie from your webcam, pick a garment, and see yourself wearing it in real time.

Built for the **YouCam API Skin AI & eCommerce VTO Hackathon** (Devpost, deadline Nov 2, 2026).

## How it works

1. **Capture photo** — Take a selfie with your webcam
2. **Upload garment** — Select a shirt/product photo (your striped polo, etc.)
3. **YouCam AI** — Server sends both images to YouCam `cloth-v4` API
4. **Result** — Photorealistic try-on image displayed on screen

## YouCam API flow (server-side)

| Step | Endpoint | Purpose |
|------|----------|---------|
| Upload | `POST /s2s/v2.0/file` | Register image, get presigned upload URL + `file_id` |
| Try-on | `POST /s2s/v2.0/task/cloth-v4` | Start virtual try-on task |
| Poll | `GET /s2s/v2.0/task/cloth-v4/{taskId}` | Check status until `success` |
| Result | Download URL from task response | Photorealistic try-on image |

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
2. Connect the repo to Vercel
3. Add `YOUCAM_API_KEY` in Vercel project settings → Environment Variables
4. Deploy — Vercel will auto-detect Next.js

## Get your free YouCam API key

1. Sign up at: https://yce.makeupar.com/ai-api (India: https://yce.makeupar.com/ai-api)
2. Redeem your free 1,000 API units (code emailed after Devpost registration)
3. Generate API key at: https://yce.makeupar.com/api-console/en/api-keys/

## Tech stack

- Next.js 15 (App Router)
- React 19 + TypeScript
- Tailwind CSS
- Perfect Corp YouCam API (Clothes V4)

## Hackathon submission

1. Record a 1–3 minute demo video showing webcam capture → garment upload → YouCam AI result
2. Upload to YouTube
3. Submit on Devpost: https://youcam-api-skin-ai-ecommerce.devpost.com/
4. Include repo URL, description, screenshots, and video link
