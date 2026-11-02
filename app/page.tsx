'use client'

import { useState, useCallback, useRef } from 'react'
import { Camera, Image, Loader2, RefreshCw, X, CheckCircle2, AlertTriangle, Smartphone } from 'lucide-react'

type Step = 'welcome' | 'capture' | 'garment' | 'processing' | 'result' | 'error'

export default function HomePage() {
  const [step, setStep] = useState<Step>('welcome')
  const [selfieBlob, setSelfieBlob] = useState<Blob | null>(null)
  selfieBlob

  const [garmentFile, setGarmentFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusMsg, setStatusMsg] = useState('')
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [garmentCategory, setGarmentCategory] = useState<'upper_body' | 'lower_body' | 'full_body' | 'outer' | 'auto'>('upper_body')

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Start camera
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 1280, height: 720 },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setStep('capture')
      setError(null)
    } catch (err) {
      setError('Camera access denied. Please allow camera permissions and try again.')
      setStep('welcome')
    }
  }, [])

  // Stop camera
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  // Capture photo from video
  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (blob) {
        setSelfieBlob(blob)
        stopCamera()
        setStep('garment')
      }
    }, 'image/jpeg', 0.9)
  }, [stopCamera])

  // Retake photo
  const retake = useCallback(() => {
    setSelfieBlob(null)
    startCamera()
  }, [startCamera])

  // Handle garment file selection
  const handleGarmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setGarmentFile(file)
      setError(null)
    }
  }

  // Start try-on process
  const startTryOn = async () => {
    if (!selfieBlob || !garmentFile) return

    setIsProcessing(true)
    setProgress(0)
    setStatusMsg('Uploading selfie to YouCam…')
    setError(null)
    setStep('processing')

    try {
      // Step 1: Upload selfie
      const selfieUpload = await fetch('/api/upload', {
        method: 'POST',
        body: JSON.stringify({
          fileName: 'selfie.jpg',
          contentType: 'image/jpeg',
          fileData: await selfieBlob.arrayBuffer(),
        }),
      })

      if (!selfieUpload.ok) {
        const err = await selfieUpload.json()
        throw new Error(err.error || 'Selfie upload failed')
      }
      const { fileId: selfieFileId } = await selfieUpload.json()

      setProgress(25)
      setStatusMsg('Uploading garment to YouCam…')

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

      setProgress(50)
      setStatusMsg('Starting YouCam AI try-on…')

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
        throw new Error(err.error || 'Try-on task creation failed')
      }
      const { taskId } = await tryOnRes.json()

      setProgress(75)
      setStatusMsg('YouCam AI is rendering your try-on…')

      // Step 4: Poll for result
      let attempts = 0
      const maxAttempts = 60
      while (attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1500))
        attempts++

        const pollRes = await fetch(`/api/task/${taskId}`)
        if (!pollRes.ok) {
          const err = await pollRes.json()
          throw new Error(err.error || 'Task poll failed')
        }
        const task = await pollRes.json()

        if (task.task_status === 'success') {
          const resultUrl = task.result?.url || task.result?.image_url || task.result?.download_url
          if (resultUrl) {
            setResultImageUrl(resultUrl)
            setProgress(100)
            setStatusMsg('Try-on complete!')
            setStep('result')
            return
          }
          throw new Error('Task succeeded but no result image found')
        }

        if (task.task_status === 'error' || task.task_status === 'failed') {
          throw new Error(task.error || 'YouCam try-on failed')
        }

        // Update progress while waiting
        setProgress(Math.min(50 + (attempts / maxAttempts) * 45, 95))
        setStatusMsg(`YouCam AI is rendering your try-on… (${attempts}/${maxAttempts})`)
      }

      throw new Error('YouCam try-on timed out. Please try again.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
      setStep('error')
    } finally {
      setIsProcessing(false)
    }
  }

  // Restart
  const restart = useCallback(() => {
    setStep('welcome')
    setSelfieBlob(null)
    setGarmentFile(null)
    setResultImageUrl(null)
    setError(null)
    setProgress(0)
    setStatusMsg('')
    stopCamera()
  }, [stopCamera])

  const categoryLabels: Record<string, string> = {
    upper_body: 'Top / Shirt',
    lower_body: 'Bottoms',
    full_body: 'Full Body',
    outer: 'Outerwear',
    auto: 'Auto-detect',
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">
                YouCam VTO
              </h1>
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-medium ml-2">
                Beta
              </span>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Powered by Perfect Corp YouCam API
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Step */}
        {step === 'welcome' && (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 mb-4">
              <Camera className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Try on clothes instantly</h2>
            <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto mb-8">
              Capture a selfie with your webcam, upload a garment photo, and let YouCam AI render you wearing it — photorealistic, in seconds.
            </p>
            <button
              onClick={startCamera}
              disabled={isProcessing}
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 transition shadow-lg shadow-blue-500/30"
            >
              <Camera className="w-5 h-5" /> Start Camera
            </button>
            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}
          </div>
        )}

        {/* Capture Step */}
        {step === 'capture' && (
          <div className="flex flex-col lg:flex-row gap-8 items-start lg:items-center justify-center min-h-[60vh]">
            <div className="relative w-full max-w-md aspect-video bg-gray-900 rounded-xl overflow-hidden shadow-2xl border border-gray-200 dark:border-gray-700">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
              <div className="absolute inset-0 flex items-center justify-center">
                <button
                  onClick={capturePhoto}
                  disabled={isProcessing}
                  className="w-20 h-20 rounded-full bg-white text-gray-900 flex items-center justify-center shadow-2xl hover:scale-105 transition transform active:scale-95 border-4 border-gray-200"
                >
                  <Camera className="w-10 h-10" />
                </button>
              </div>
              {isProcessing && (
                <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center z-10">
                  <Loader2 className="w-8 h-8 animate-spin text-white mb-2" />
                  <p className="text-white text-sm">{statusMsg}</p>
                </div>
              )}
            </div>

            <div className="w-full max-w-md space-y-4">
              <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Step 1 of 3</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Position yourself in the frame and tap the camera button to capture your photo.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={retake}
                  className="flex-1 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium"
                >
                  <RefreshCw className="w-4 h-4 mr-2" /> Retake
                </button>
                <button
                  onClick={capturePhoto}
                  disabled={isProcessing}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  Use This Photo
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Garment Step */}
        {step === 'garment' && (
          <div className="text-center py-12">
            <div className="flex justify-center mb-8">
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <span className="w-2 h-2 rounded-full bg-blue-600" />
                <span>1. Selfie captured</span>
                <span className="text-gray-300">→</span>
                <span className="font-medium text-gray-900 dark:text-white">2. Upload garment</span>
                <span className="text-gray-300">→</span>
                <span className="text-gray-400">3. See result</span>
              </div>
            </div>

            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Upload your garment</h2>
            <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto mb-8">
              Select a photo of the shirt or clothing you want to try on. Works best with a clear product photo on a plain background.
            </p>

            <div className="max-w-md mx-auto space-y-4">
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
                  file:bg-blue-50 file:text-blue-700
                  hover:file:bg-blue-100
                  dark:file:bg-blue-900/20 dark:file:text-blue-400
                  cursor-pointer"
              />
              {garmentFile && (
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800 flex items-center gap-3">
                  <Image className="w-12 h-12 rounded object-cover" src={URL.createObjectURL(garmentFile)} alt="garment" />
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{garmentFile.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {Math.round(garmentFile.size / 1024)} KB
                    </p>
                  </div>
                </div>
              )}

              <div className="pt-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  Garment category
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {['upper_body', 'lower_body', 'full_body', 'outer', 'auto'].map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setGarmentCategory(cat as any)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
                        garmentCategory === cat
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      {categoryLabels[cat]}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={startTryOn}
                disabled={!garmentFile || isProcessing}
                className="mt-6 w-full py-4 px-6 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 transition shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Processing…
                  </>
                ) : (
                  <>Generate Try-On</>
                )}
              </button>

              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}
            </div>

            <button onClick={retake} className="mt-8 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300">
              ← Change photo
            </button>
          </div>
        )}

        {/* Processing Step */}
        {step === 'processing' && (
          <div className="text-center py-20">
            <div className="relative w-24 h-24 mx-auto mb-6">
              <Loader2 className="w-12 h-12 text-blue-600 animate-spin absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              <div className="absolute inset-0 border-4 border-blue-100 dark:border-blue-900/30 rounded-full border-t-blue-600 animate-spin" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">{statusMsg}</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              This usually takes 10–30 seconds. YouCam AI is rendering your photorealistic try-on.
            </p>
            <div className="mt-8 w-full max-w-xs">
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{progress}%</p>
            </div>
            <button
              onClick={restart}
              className="mt-6 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Result Step */}
        {step === 'result' && (
          <div className="py-12">
            <div className="flex justify-center mb-8">
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span>1. Selfie captured</span>
                <span className="text-gray-300">→</span>
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span>2. Garment uploaded</span>
                <span className="text-gray-300">→</span>
                <span className="font-medium text-gray-900 dark:text-white">3. Try-on result</span>
              </div>
            </div>

            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Your try-on result</h2>

            <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4">
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Original selfie</h3>
                {selfieBlob && (
                  <img
                    src={URL.createObjectURL(selfieBlob)}
                    alt="Original selfie"
                    className="w-full h-64 object-cover rounded-lg bg-gray-100 dark:bg-gray-700"
                  />
                )}
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4 relative overflow-hidden">
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">YouCam AI Try-On</h3>
                {resultImageUrl && (
                  <img
                    src={resultImageUrl}
                    alt="Try-on result"
                    className="w-full h-64 object-cover rounded-lg bg-gray-100 dark:bg-gray-700"
                  />
                )}
                <button
                  onClick={() => {
                    if (resultImageUrl) {
                      const link = document.createElement('a')
                      link.href = resultImageUrl
                      link.download = 'youcam-tryon-result.jpg'
                      link.click()
                    }
                  }}
                  className="absolute top-2 right-2 p-2 bg-black/60 text-white rounded-lg hover:bg-black/80 transition"
                  title="Download"
                >
                  <Smartphone className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="mt-8 flex gap-3 justify-center">
              <button
                onClick={startTryOn}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
                disabled={isProcessing}
              >
                Try another garment
              </button>
              <button
                onClick={restart}
                className="px-6 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition"
              >
                Start over
              </button>
            </div>
          </div>
        )}

        {/* Error Step */}
        {step === 'error' && (
          <div className="text-center py-20">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Something went wrong</h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">{error}</p>
            <button
              onClick={restart}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
            >
              Try again
            </button>
          </div>
        )}
      </main>

      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            Built with <span className="text-blue-600 dark:text-blue-400">YouCam API (Perfect Corp)</span> •
            for the YouCam API Skin AI & eCommerce VTO Hackathon •
            Demo uses ~2 API units per try-on
          </p>
        </div>
      </footer>
    </div>
  )
}
