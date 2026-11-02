'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Camera, Smartphone, Play, Loader2, Image, AlertCircle } from 'lucide-react'

import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

type Step = 'welcome' | 'live' | 'error'

export default function HomePage() {
  const [step, setStep] = useState<Step>('welcome')
  const [isLive, setIsLive] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [garmentFile, setGarmentFile] = useState<File | null>(null)
  const [youCamResult, setYouCamResult] = useState<string | null>(null)
  const [mediaPipeReady, setMediaPipeReady] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null)
  let isDisposed = false

  const startCamera = useCallback(async () => {
    setError(null)
    setStatusMsg('Requesting camera permission…')
    try {
      // Relaxed constraints — ask for HD but accept what the browser gives
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          frameRate: { ideal: 30, min: 15 },
        },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setIsLive(true)
      setStep('live')
      isDisposed = false
    } catch (err: any) {
      const msg = err?.message || String(err)
      setError(`Camera access failed: ${msg}. Please allow camera access and try again.`)
      setStep('welcome')
      setStatusMsg('')
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
    setIsLive(false)
  }, [])

  const restart = useCallback(() => {
    stopCamera()
    setStep('welcome')
    setError(null)
    setIsProcessing(false)
    setYouCamResult(null)
    setGarmentFile(null)
    setMediaPipeReady(false)
    isDisposed = true
  }, [stopCamera])

  useEffect(() => {
    return () => { stopCamera() }
  }, [stopCamera])

  const sendFrameToYouCam = useCallback(async () => {
    if (isDisposed || !garmentFile || isProcessing || !videoRef.current) return

    setIsProcessing(true)
    setStatusMsg('Sending frame to YouCam AI…')

    try {
      const canvas = canvasRef.current
      const video = videoRef.current
      if (!canvas || !video) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      canvas.width = video.videoWidth || 640
      canvas.height = video.videoHeight || 360
      ctx.drawImage(video, 0, 0)

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85)
      })
      if (!blob) return

      const formData = new FormData()
      formData.append('image', blob, 'frame.jpg')
      if (garmentFile) formData.append('garment', garmentFile, garmentFile.name)

      const res = await fetch('/api/tryon', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'YouCam try-on failed')

      if (data.resultUrl) {
        setYouCamResult(data.resultUrl)
        setStatusMsg('YouCam AI render ready')
      } else {
        setStatusMsg(data.message || 'Processing…')
      }
    } catch (err: any) {
      const msg = err?.message || 'YouCam request failed'
      setStatusMsg(msg)
      setError(msg)
    } finally {
      setIsProcessing(false)
    }
  }, [garmentFile, isProcessing])

  useEffect(() => {
    if (step !== 'live') return

    let visionRunning = false
    let cancelled = false

    const initVision = async () => {
      try {
        setStatusMsg('Loading MediaPipe Pose model…')
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        )
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        })
        if (cancelled) return
        poseLandmarkerRef.current = landmarker
        setMediaPipeReady(true)
        setStatusMsg('MediaPipe Pose ready')
      } catch (err: any) {
        if (cancelled) return
        console.error('MediaPipe init failed', err)
        setError(`MediaPose failed to load: ${err?.message || String(err)}`)
        setStatusMsg('')
      }
    }

    void initVision()

    const drawLoop = () => {
      if (isDisposed || step !== 'live' || cancelled) return
      const video = videoRef.current
      const canvas = canvasRef.current
      const landmarker = poseLandmarkerRef.current
      if (!video || !canvas || !landmarker || !video.videoWidth) {
        rafRef.current = requestAnimationFrame(drawLoop)
        return
      }

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) { rafRef.current = requestAnimationFrame(drawLoop); return }

      ctx.drawImage(video, 0, 0)

      if (!visionRunning && landmarker) {
        visionRunning = true
        landmarker.detectForVideo(video, performance.now(), (result) => {
          visionRunning = false
          if (cancelled) return
          try {
            if (result.landmarks && result.landmarks[0]) {
              const lm = result.landmarks[0]
              const lShoulder = lm[11]
              const rShoulder = lm[12]
              const lHip = lm[23]
              const rHip = lm[24]

              const cx = (lShoulder.x + rShoulder.x + lHip.x + rHip.x) / 4
              const cy = (lShoulder.y + rShoulder.y + lHip.y + rHip.y) / 4
              const shoulderW = Math.hypot(lShoulder.x - rShoulder.x, lShoulder.y - rShoulder.y)
              const torsoH = Math.hypot((lShoulder.y + rShoulder.y) / 2 - (lHip.y + rHip.y) / 2, (lShoulder.x + rShoulder.x) / 2 - (lHip.x + rHip.x) / 2)

              const shirtW = shoulderW * 1.4
              const shirtH = torsoH * 1.6
              const shirtX = (cx - shirtW / 2) * canvas.width
              const shirtY = (cy - shirtH / 3) * canvas.height

              if (garmentFile) {
                const img = document.createElement('img')
                img.crossOrigin = 'anonymous'
                img.src = URL.createObjectURL(garmentFile)
                img.onload = () => {
                  ctx.save()
                  ctx.translate(shirtX + shirtW / 2, shirtY + shirtH / 2)
                  ctx.drawImage(img, -shirtW / 2, -shirtH / 2, shirtW, shirtH)
                  ctx.restore()
                  URL.revokeObjectURL(img.src)
                }
              }
            }
          } catch (e) {
            // overlay draw errors are non-fatal
          }
        })
      }

      rafRef.current = requestAnimationFrame(drawLoop)
    }

    rafRef.current = requestAnimationFrame(drawLoop)

    // Send frames to YouCam every 3 seconds when garment is selected
    if (garmentFile) {
      frameIntervalRef.current = setInterval(() => {
        void sendFrameToYouCam()
      }, 3000)
    }

    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current)
    }
  }, [step, garmentFile, sendFrameToYouCam, isDisposed])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">YouCam Live VTO</h1>
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium ml-2">Live + AI</span>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">Live pose overlay + YouCam AI photorealistic render</div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
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
                  <li>YouCam cloth-v4 API adds photorealistic AI render</li>
                </ol>
              </div>
              <div className="alert bg-amber-50 border border-amber-200 rounded-lg p-4 text-left">
                <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-2">⚠️ YouCam API key required</h3>
                <p className="text-xs text-amber-800 dark:text-amber-300">Hackathon requires YouCam API. Get free key at yce.makeupar.com/ai-api. Add as YOUCAM_API_KEY env var.</p>
              </div>
            </div>

            <button
              onClick={startCamera}
              disabled={isProcessing}
              className="inline-flex items-center gap-2 px-8 py-4 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 disabled:opacity-50 transition shadow-lg shadow-green-500/30"
            >
              <Play className="w-5 h-5" /> Start Live Camera
            </button>
            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        {step === 'live' && (
          <div className="flex flex-col lg:flex-row gap-8 items-start lg:items-center justify-center min-h-[70vh]">
            <div className="relative w-full max-w-lg aspect-video bg-gray-900 rounded-xl overflow-hidden shadow-2xl border-2 border-gray-200 dark:border-gray-700">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover transform scaleX(-1)" />
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full transform scaleX(-1)" />

              {!mediaPipeReady && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/80">
                  <Loader2 className="w-8 h-8 text-white animate-spin mb-2" />
                  <p className="text-white text-sm">Loading MediaPipe Pose model…</p>
                </div>
              )}

              <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/90 text-white text-xs font-bold animate-pulse">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" /> LIVE
              </div>
            </div>

            <div className="w-full max-w-lg flex flex-col gap-4">
              {youCamResult && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-green-500 text-white text-sm font-semibold shadow-lg shadow-green-500/40">
                  <Smartphone className="w-3 h-3" /> YouCam AI render active — photorealistic
                </div>
              )}

              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Garment</label>
                  <div className="relative group">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null
                        if (f) setGarmentFile(f)
                      }}
                      className="sr-only"
                    />
                    <button
                      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                        const input = e.currentTarget.closest('div')?.querySelector('input') as HTMLInputElement | null
                        input?.click()
                      }}
                      className={`w-full p-3 border-2 border-dashed rounded-lg transition text-left ${garmentFile ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-white border-gray-300 dark:bg-gray-800 dark:border-gray-700 hover:border-green-400 dark:hover:border-green-500'}`}
                    >
                      <div className="flex items-center justify-center gap-2">
                        <Image className="w-4 h-4" />
                        {garmentFile ? `Change (${garmentFile.name})` : 'Upload garment image'}
                      </div>
                    </button>
                  </div>
                  {garmentFile && (
                    <div className="mt-2 p-2 bg-green-50 dark:bg-green-900/20 rounded border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-300">
                      {garmentFile.name} • {Math.round(garmentFile.size / 1024)} KB
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                <button
                  onClick={restart}
                  className="px-6 py-3 bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-white rounded-xl font-semibold hover:bg-gray-300 dark:hover:bg-gray-700 transition"
                >
                  Restart
                </button>
                <button
                  onClick={() => {}}
                  disabled={!garmentFile || isProcessing}
                  className={`px-8 py-3 rounded-xl font-semibold transition shadow-lg ${!garmentFile || isProcessing ? 'bg-gray-400 text-gray-200 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700 shadow-green-500/40'}`}
                >
                  {isProcessing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    'Try On With YouCam'
                  )}
                </button>
              </div>

              {statusMsg && <div className="text-xs text-gray-500 dark:text-gray-400">{statusMsg}</div>}
              {error && (
                <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">MediaPipe Pose (live overlay) + YouCam API Clothes V4 (photorealistic AI) • YouCam API Skin AI & eCommerce VTO Hackathon</p>
        </div>
      </footer>
    </div>
  )
}
