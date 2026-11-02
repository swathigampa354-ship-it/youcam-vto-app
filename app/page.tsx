'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Camera, Image, Loader2, RefreshCw, X, CheckCircle2, Smartphone, Play, Pause, EyeOff, Eye } from 'lucide-react'

type Step = 'welcome' | 'live' | 'result' | 'error'

export default function HomePage() {
  const [step, setStep] = useState<Step>('welcome')
  const [isLive, setIsLive] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [garmentFile, setGarmentFile] = useState<File | null>(null)
  const [garmentCategory, setGarmentCategory] = useState<'upper_body' | 'lower_body' | 'full_body' | 'outer' | 'auto'>('upper_body')
  const [frameCount, setFrameCount] = useState(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationRef = useRef<number | null>(null)
  let lastSendTime = 0
  let isDisposed = false

  const categoryLabels: Record<string, string> = {
    upper_body: 'Top / Shirt',
    lower_body: 'Bottoms',
    full_body: 'Full Body',
    outer: 'Outerwear',
    auto: 'Auto-detect',
  }

  // Start live camera
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
      lastSendTime = 0
    } catch (err) {
      setError('Camera access denied. Please allow camera permissions and try again.')
      setStep('welcome')
    }
  }, [])

  // Stop camera
  const stopCamera = useCallback(() => {
    isDisposed = true
    if (animationRef.current) cancelAnimationFrame(animationRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setIsLive(false)
  }, [])

  // Handle garment file selection
  const handleGarmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setGarmentFile(file)
      setError(null)
    }
  }

  // Send current video frame to YouCam API
  const sendFrameToYouCam = useCallback(async () => {
    if (!videoRef.current || !garmentFile || isDisposed) return

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

        // Step 1: Upload selfie frame
        const selfieUpload = await fetch('/api/upload', {
          method: 'POST',
          body: JSON.stringify({
            fileName: `frame_${Date.now()}.jpg`,
            contentType: 'image/jpeg',
            fileData: await blob.arrayBuffer(),
          }),
        })

        if (!selfieUpload.ok) {
          const err = await selfieUpload.json()
          throw new Error(err.error || 'Frame upload failed')
        }
        const { fileId: selfieFileId } = await selfieUpload.json()

        // Step 2: Upload garment
        const garmentUpload = await fetch('/api/upload', {
          method: 'POST',
          body: JSON.stringify({
            fileName: garmentFile.name,
            contentType: garmentFile.type,
            fileData: await garmentFile.arrayBuffer(),
          }),
        })

        if (!garmentUpload.ok) {
          const err = await garmentUpload.json()
          throw new Error(err.error || 'Garment upload failed')
        }
        const { fileId: garmentFileId } = await garmentUpload.json()

        // Step 3: Create try-on task
        const tryOnRes = await fetch('/api/tryon', {
          method: 'POST',
          body: JSON.stringify({
            srcFileId: selfieFileId,
            refFileId: garmentFileId,
            garmentCategory,
          }),
        })

        if (!tryOnRes.ok) {
          const err = await tryOnRes.json()
          throw new Error(err.error || 'Try-on task failed')
        }
        const { taskId } = await tryOnRes.json()

        setStatusMsg('YouCam AI rendering live frame…')

        // Step 4: Poll for result (short timeout for live feel)
        let attempts = 0
        const maxAttempts = 20 // ~10 seconds max per frame
        while (attempts < maxAttempts && !isDisposed) {
          await new Promise((r) => setTimeout(r, 500))
          attempts++

          const pollRes = await fetch(`/api/task/${taskId}`)
          if (!pollRes.ok) break

          const task = await pollRes.json()

          if (task.task_status === 'success') {
            const resultUrl =
              task.result?.url ||
              task.result?.image_url ||
              task.result?.download_url
            if (resultUrl && !isDisposed) {
              setResultImageUrl(resultUrl)
              setFrameCount((c) => c + 1)
              setStatusMsg('Live render active — YouCam AI on frame')
            }
            return
          }

          if (task.task_status === 'error' || task.task_status === 'failed') {
            return // silently skip failed frames in live mode
          }
        }
      } catch (err) {
        // In live mode, don't show errors for individual frame failures
        console.warn('Live frame try-on failed:', err)
      }
    }, [garmentFile, garmentCategory, isDisposed])

  // Live render loop — capture and send frames to YouCam
  useEffect(() => {
    if (!isLive || !videoRef.current || isDisposed) return

    const loop = async () => {
      if (isDisposed) return

      const now = performance.now()
      // Send a frame to YouCam every 3 seconds (respects API rate limits)
      if (now - lastSendTime > 3000 && garmentFile) {
        lastSendTime = now
        void sendFrameToYouCam()
      }

      animationRef.current = requestAnimationFrame(loop)
    }

    loop()

    return () => {
      isDisposed = true
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [isLive, garmentFile, sendFrameToYouCam])

  // Restart
  const restart = useCallback(() => {
    stopCamera()
    setStep('welcome')
    setResultImageUrl(null)
    setError(null)
    setFrameCount(0)
    setStatusMsg('')
    setIsLive(false)
    lastSendTime = 0
    isDisposed = true
  }, [stopCamera])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [stopCamera])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      {/* Header */}
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
                Live Video
              </span>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Live video rendering · YouCam API Cloth V4
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Welcome Step */}
        {step === 'welcome' && (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 mb-6">
              <Camera className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Live clothes try-on on webcam</h2>
            <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto mb-8">
              Turn on your camera, upload a garment photo, and YouCam AI renders the clothes on you in real-time video.
            </p>

            <div className="max-w-md mx-auto space-y-4 mb-8">
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800 text-left">
                <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">How it works</h3>
                <ol className="text-sm text-blue-800 dark:text-blue-300 space-y-2 list-disc list-inside">
                  <li>Enable camera — see yourself live</li>
                  <li>Upload a garment photo (shirt, top, etc.)</li>
                  <li>YouCam AI renders the garment on your live video feed</li>
                  <li>Results update continuously as you move</li>
                </ol>
              </div>

              <div className="alert bg-amber-50 border border-amber-200 rounded-lg p-4 text-left">
                <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-2">⚠️ YouCam API key required</h3>
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  This hackathon requires the YouCam API. Get your free key at yce.makeupar.com/ai-api and add it as YOUCAM_API_KEY in your environment.
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
            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}
          </div>
        )}

        {/* Live Step */}
        {step === 'live' && (
          <div className="flex flex-col lg:flex-row gap-8 items-start lg:items-center justify-center min-h-[70vh]">
            {/* Video display */}
            <div className="relative w-full max-w-lg aspect-video bg-gray-900 rounded-xl overflow-hidden shadow-2xl border-2 border-gray-200 dark:border-gray-700">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform scaleX(-1)"
              />
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full transform scaleX(-1)" />

              {/* Live indicator */}
              <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/90 text-white text-xs font-bold animate-pulse">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                LIVE
              </div>

              {/* YouCam result overlay */}
              {resultImageUrl && (
                <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
                  <div className="bg-black/60 backdrop-blur px-3 py-1 rounded-lg text-white text-sm">
                    YouCam AI render #{frameCount}
                  </div>
                  <button
                    onClick={() => {
                      const link = document.createElement('a')
                      link.href = resultImageUrl
                      link.download = `youcam-live-frame-${Date.now()}.jpg`
                      link.click()
                    }}
                    className="p-2 bg-black/60 text-white rounded-lg hover:bg-black/80 transition"
                    title="Download frame"
                  >
                    <Smartphone className="w-5 h-5" />
                  </button>
                </div>
              )}

              {/* Processing overlay */}
              {isProcessing && (
                <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center z-20">
                  <Loader2 className="w-8 h-8 text-white animate-spin mb-2" />
                  <p className="text-white text-sm">{statusMsg}</p>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="w-full max-w-md space-y-4">
              <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Live Controls</h3>

                <div className="space-y-3">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Garment image
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleGarmentChange}
                    className="block w-full text-sm text-gray-500
                      file:mr-4 file:py-2 file:px-4
                      file:rounded-full file:border-0
                      file:text-sm file:font-semibold
                      file:bg-green-50 file:text-green-700
                      hover:file:bg-green-100
                      dark:file:bg-green-900/20 dark:file:text-green-400
                      cursor-pointer"
                  />
                  {garmentFile && (
                    <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-100 dark:border-green-800 flex items-center gap-3">
                      <Image className="w-12 h-12 rounded object-cover" src={URL.createObjectURL(garmentFile)} alt="garment" />
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{garmentFile.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {Math.round(garmentFile.size / 1024)} KB
                        </p>
                      </div>
                    </div>
                  )}

                  <label className="mt-4 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Garment category
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {['upper_body', 'lower_body', 'full_body', 'outer', 'auto'].map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setGarmentCategory(cat as any)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
                          garmentCategory === cat
                            ? 'bg-green-600 text-white border-green-600'
                            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        {categoryLabels[cat]}
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Frames rendered: {frameCount}
                    </span>
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
                    <strong>Note:</strong> YouCam API processes images asynchronously (~10-30s per frame). In live mode, frames are sent every 3 seconds and results appear as they complete.
                  </p>
                </div>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Result Step (single frame capture) */}
        {step === 'result' && (
          <div className="text-center py-20">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Try-on result</h3>
            <div className="max-w-lg mx-auto">
              {resultImageUrl && (
                <img
                  src={resultImageUrl}
                  alt="YouCam try-on result"
                  className="w-full max-h-[500px] object-contain rounded-xl bg-gray-100 dark:bg-gray-800 shadow-lg"
                />
              )}
            </div>
            <div className="mt-6 flex gap-3 justify-center">
              <button
                onClick={startCamera}
                className="px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition"
              >
                Back to Live
              </button>
              <button
                onClick={restart}
                className="px-6 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition"
              >
                Start Over
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            Powered by <span className="text-green-600 dark:text-green-400">YouCam API Clothes V4</span> •
            Live webcam rendering • YouCam API Skin AI & eCommerce VTO Hackathon
          </p>
        </div>
      </footer>
    </div>
  )
}
