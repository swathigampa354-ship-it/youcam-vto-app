'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Camera, Image, Loader2, RefreshCw, CheckCircle2, Smartphone, Play, X, AlertTriangle } from 'lucide-react'

type Step = 'welcome' | 'live' | 'error'

export default function HomePage() {
  const [step, setStep] = useState<Step>('welcome')
  const [isLive, setIsLive] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [youcamResult, setYoucamResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [garmentFile, setGarmentFile] = useState<File | null>(null)
  const [showYoucam, setShowYoucam] = useState(false)
  const [frameCount, setFrameCount] = useState(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animRef = useRef<number | null>(null)
  let isDisposed = false
  let lastYoucamSend = 0

  // ---------- Camera ----------
  const startCamera = useCallback(async () => {
    try {
      setStatusMsg('Requesting camera permission…')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 1280, height: 720, frameRate: 30 },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setIsLive(true)
      setStep('live')
      setError(null)
      isDisposed = false
      lastYoucamSend = 0
    } catch (err) {
      setError('Camera access denied. Please allow camera permissions and try again.')
      setStep('welcome')
    }
  }, [])

  const stopCamera = useCallback(() => {
    isDisposed = true
    if (animRef.current) cancelAnimationFrame(animRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
    setIsLive(false)
  }, [])

  // ---------- Garment upload ----------
  const handleGarmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) { setGarmentFile(f); setError(null) }
  }

  // ---------- YouCam async try-on (sends captured frames) ----------
  const sendFrameToYouCam = useCallback(async () => {
    if (!videoRef.current || !garmentFile || isDisposed) return
    const now = performance.now()
    if (now - lastYoucamSend < 4000) return // max once per 4s to respect API limits
    lastYoucamSend = now

    const video = videoRef.current
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    canvas.toBlob(async (blob) => {
      if (!blob || isDisposed) return
      try {
        setStatusMsg('Sending frame to YouCam AI…')

        const selfieUp = await fetch('/api/upload', {
          method: 'POST',
          body: JSON.stringify({
            fileName: `frame_${Date.now()}.jpg`,
            contentType: 'image/jpeg',
            fileData: await blob.arrayBuffer(),
          }),
        })
        if (!selfieUp.ok) throw new Error('Selfie upload failed')
        const { fileId: selfieFileId } = await selfieUp.json()

        const garmentUp = await fetch('/api/upload', {
          method: 'POST',
          body: JSON.stringify({
            fileName: garmentFile.name,
            contentType: garmentFile.type,
            fileData: await garmentFile.arrayBuffer(),
          }),
        })
        if (!garmentUp.ok) throw new Error('Garment upload failed')
        const { fileId: garmentFileId } = await garmentUp.json()

        const tryOn = await fetch('/api/tryon', {
          method: 'POST',
          body: JSON.stringify({
            srcFileId: selfieFileId,
            refFileId: garmentFileId,
            garmentCategory: 'upper_body',
          }),
        })
        if (!tryOn.ok) throw new Error('Try-on task failed')
        const { taskId } = await tryOn.json()

        setStatusMsg('YouCam AI rendering live frame…')

        // Poll with short timeout for live feel
        let attempts = 0
        const maxAttempts = 24 // ~12 seconds max per frame
        while (attempts < maxAttempts && !isDisposed) {
          await new Promise((r) => setTimeout(r, 500))
          attempts++

          const poll = await fetch(`/api/task/${taskId}`)
          if (!poll.ok) break
          const task = await poll.json()

          if (task.task_status === 'success') {
            const url = task.result?.url || task.result?.image_url || task.result?.download_url
            if (url && !isDisposed) {
              setYoucamResult(url)
              setShowYoucam(true)
              setFrameCount((c) => c + 1)
              setStatusMsg('YouCam AI render active')
            }
            return
          }
          if (task.task_status === 'error' || task.task_status === 'failed') return
        }
      } catch (err) {
        // Silent in live mode — don't spam errors for individual frames
        console.warn('YouCam live frame failed:', err)
      }
    }, [garmentFile, isDisposed])

  // ---------- MediaPipe Pose live overlay ----------
  // Lazy-load MediaPipe from CDN
  useEffect(() => {
    if (!isLive || isDisposed) return

    const loadMediaPipe = async () => {
      const { PoseLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
      const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task'

      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
      )
      const landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL },
        runningMode: 'VIDEO',
        numPoses: 1,
      })

      const shirtImg = new Image()
      shirtImg.crossOrigin = 'anonymous'
      if (garmentFile) shirtImg.src = URL.createObjectURL(garmentFile)

      const LS = 11, RS = 12, LH = 23, RH = 24
      const norm = (lm: any, w: number, h: number) => ({ x: lm.x * w, y: lm.y * h })

      const drawShirt = (lm: any[], w: number, h: number) => {
        if (!shirtImg.complete) return
        const ls = norm(lm[LS], w, h)
        const rs = norm(lm[RS], w, h)
        const lh = norm(lm[LH], w, h)
        const rh = norm(lm[RH], w, h)

        const smx = (ls.x + rs.x) / 2
        const smy = (ls.y + rs.y) / 2
        const hmx = (lh.x + rh.x) / 2
        const hmy = (lh.y + rh.y) / 2

        const shoulderW = Math.hypot(rs.x - ls.x, rs.y - ls.y)
        const torsoH = Math.hypot(hmx - smx, hmy - smy)
        if (shoulderW < 20 || torsoH < 20) return

        const shirtW = shoulderW * 2.4
        const shirtH = torsoH * 1.9
        const imgAspect = shirtImg.naturalWidth / shirtImg.naturalHeight
        let drawW = shirtW
        let drawH = shirtW / imgAspect
        if (drawH < shirtH * 0.75) { drawH = shirtH; drawW = shirtH * imgAspect }

        const angle = Math.atan2(rs.y - ls.y, rs.x - ls.x)
        const cx = smx
        const cy = smy + torsoH * 0.12

        const ctx = canvasRef.current!.getContext('2d')!
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(angle)
        ctx.drawImage(shirtImg, -drawW / 2, -drawH / 2, drawW, drawH)
        ctx.restore()
      }

      const loop = async () => {
        if (isDisposed || !videoRef.current) return
        const now = performance.now()

        // Send frame to YouCam periodically
        if (garmentFile) void sendFrameToYouCam()

        // MediaPipe pose detection
        landmarker.detectForVideo(videoRef.current, now, (result) => {
          if (isDisposed) return
          const ctx = canvasRef.current!.getContext('2d')!
          const w = canvasRef.current!.width
          const h = canvasRef.current!.height
          ctx.clearRect(0, 0, w, h)

          if (result.poseLandmarks && result.poseLandmarks.length > 0) {
            drawShirt(result.poseLandmarks[0], w, h)
          } else {
            // No person detected — show hint
            ctx.fillStyle = 'rgba(255,255,255,0.12)'
            ctx.font = '16px system-ui'
            ctx.textAlign = 'center'
            ctx.fillText('Step into the frame', w / 2, h / 2)
          }
        })

        animRef.current = requestAnimationFrame(loop)
      }

      loop()
    }

    loadMediaPipe().catch((err) => {
      console.error('MediaPipe load failed:', err)
      setStatusMsg('Pose tracker failed — live overlay unavailable')
    })

    return () => { isDisposed = true }
  }, [isLive, garmentFile, sendFrameToYouCam])

  // ---------- Restart ----------
  const restart = useCallback(() => {
    stopCamera()
    setStep('welcome')
    setYoucamResult(null)
    setShowYoucam(false)
    setError(null)
    setFrameCount(0)
    setStatusMsg('')
    isDisposed = true
  }, [stopCamera])

  useEffect(() => {
    return () => { stopCamera() }
  }, [stopCamera])

  // ---------- UI ----------
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">
                YouCam Live VTO
              </h1>
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium ml-2">
                Live + AI
              </span>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Live pose overlay + YouCam AI photorealistic render
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Welcome */}
        {step === 'welcome' && (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 mb-6">
              <Camera className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Live clothes try-on on webcam</h2>
            <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto mb-8">
              Turn on your camera. MediaPipe Pose renders your shirt instantly on your body. YouCam AI adds photorealistic quality on top.
            </p>

            <div className="max-w-md mx-auto space-y-4 mb-8">
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800 text-left">
                <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">Architecture</h3>
                <ol className="text-sm text-blue-800 dark:text-blue-300 space-y-2 list-disc list-inside">
                  <li>Camera on — see yourself live</li>
                  <li>MediaPipe Pose tracks your body instantly</li>
                  <li>Shirt asset renders on you in real-time (pose overlay)</li>
                  <li>YouCam cloth-v4 API adds photorealistic AI render (async, ~10-30s per frame)</li>
                </ol>
              </div>
              <div className="alert bg-amber-50 border border-amber-200 rounded-lg p-4 text-left">
                <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-2">⚠️ YouCam API key required</h3>
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Hackathon requires YouCam API. Get free key at yce.makeupar.com/ai-api. Add as YOUCAM_API_KEY env var.
                </p>
              </div>
            </div>

            <button
              onClick={startCamera}
              disabled={isProcessing}
              className="inline-flex items-center gap-2 px-8 py-4 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 disabled:opacity-50 transition shadow-lg shadow-green-500/30"
            >
              <Play className="w-5 h-5" /> Start Live Camera
            </button>
            {error && <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
          </div>
        )}

        {/* Live */}
        {step === 'live' && (
          <div className="flex flex-col lg:flex-row gap-8 items-start lg:items-center justify-center min-h-[70vh]">
            <div className="relative w-full max-w-lg aspect-video bg-gray-900 rounded-xl overflow-hidden shadow-2xl border-2 border-gray-200 dark:border-gray-700">
              <video
                ref={videoRef}
                autoPlay playsInline muted
                className="w-full h-full object-cover transform scaleX(-1)"
              />
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full transform scaleX(-1)" />

              {/* Live badge */}
              <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/90 text-white text-xs font-bold animate-pulse">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" /> LIVE
              </div>

              {/* YouCam result overlay */}
              {youcamResult && (
                <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
                  <div className="bg-black/60 backdrop-blur px-3 py-1 rounded-lg text-white text-sm">
                    YouCam AI photorealistic render #{frameCount}
                  </div>
                  <button
                    onClick={() => {
                      const a = document.createElement('a')
                      a.href = youcamResult
                      a.download = `youcam-live-${Date.now()}.jpg`
                      a.click()
                    }}
                    className="p-2 bg-black/60 text-white rounded-lg hover:bg-black/80 transition"
                    title="Download"
                  >
                    <Smartphone className="w-5 h-5" />
                  </button>
                </div>
              )}

              {isProcessing && (
                <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center z-20">
                  <Loader2 className="w-8 h-8 text-white animate-spin mb-2" />
                  <p className="text-white text-sm">{statusMsg}</p>
                </div>
              )}
            </div>

            <div className="w-full max-w-md space-y-4">
              <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Controls</h3>
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Garment image</label>
                  <input
                    type="file" accept="image/*" onChange={handleGarmentChange}
                    className="block w-full text-sm text-gray-500
                      file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0
                      file:text-sm file:font-semibold file:bg-green-50 file:text-green-700
                      hover:file:bg-green-100 dark:file:bg-green-900/20 dark:file:text-green-400 cursor-pointer"
                  />
                  {garmentFile && (
                    <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-100 dark:border-green-800 flex items-center gap-3">
                      <Image className="w-12 h-12 rounded object-cover" src={URL.createObjectURL(garmentFile)} alt="garment" />
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{garmentFile.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{Math.round(garmentFile.size / 1024)} KB</p>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-xs text-gray-500 dark:text-gray-400">AI renders: {frameCount}</span>
                    <button
                      onClick={stopCamera}
                      className="px-3 py-1.5 bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 rounded-lg text-xs font-medium border border-red-100 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40 transition"
                    >
                      Stop Camera
                    </button>
                  </div>
                </div>

                <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800">
                  <p className="text-xs text-blue-800 dark:text-blue-300">
                    <strong>Live:</strong> MediaPipe Pose overlay is instant.<br />
                    <strong>YouCam AI:</strong> Photorealistic frames appear as they complete (~10-30s each).
                  </p>
                </div>
              </div>

              {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
            </div>
          </div>
        )}
      </main>

      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            MediaPipe Pose (live overlay) + YouCam API Clothes V4 (photorealistic AI) •
            YouCam API Skin AI & eCommerce VTO Hackathon
          </p>
        </div>
      </footer>
    </div>
  )
}
