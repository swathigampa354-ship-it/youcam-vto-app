/**
 * YouCam API client — Clothes Virtual Try-On (V4)
 * All calls are server-side only. The API key never reaches the browser.
 * Env vars are read inside each function (not at module load) so the build
 * doesn't crash when they're missing.
 */

const defaultBaseUrl = 'https://yce-api-01.makeupar.com'

function getBaseUrl(): string {
  return process.env.YOUCAM_BASE_URL || defaultBaseUrl
}

function getApiKey(): string {
  const key = process.env.YOUCAM_API_KEY
  if (!key) {
    throw new Error('YOUCAM_API_KEY is not set. YouCam API calls will fail.')
  }
  return key
}

export interface YouCamFileUploadResponse {
  requests: {
    url: string
    method: string
    headers: Record<string, string>
  }
  file_id: string
  // additional fields may be present
}

export interface YouCamTaskCreateResponse {
  task_id: string
  task_status: string
  // additional fields may be present
}

export interface YouCamTaskStatusResponse {
  task_id: string
  task_status: 'pending' | 'success' | 'error' | 'failed'
  result?: {
    url?: string
    image_url?: string
    download_url?: string
  }
  error?: string
}

/**
 * Step 1: Register an image for upload.
 * Returns { file_id, uploadUrl } — the client PUTs the image bytes to uploadUrl.
 */
export async function registerFileUpload(
  fileName: string,
  contentType: string
): Promise<{ fileId: string; uploadUrl: string }> {
  const res = await fetch(`${getBaseUrl()}/s2s/v2.0/file`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      file_name: fileName,
      content_type: contentType,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`YouCam file upload registration failed: ${res.status} ${text}`)
  }

  const data: YouCamFileUploadResponse = await res.json()

  return {
    fileId: data.file_id,
    uploadUrl: data.requests.url,
  }
}

/**
 * Step 1b: Upload image bytes to the presigned URL returned by registerFileUpload.
 */
export async function uploadFileBytes(
  uploadUrl: string,
  fileBytes: ArrayBuffer,
  contentType: string
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
    },
    body: fileBytes,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`YouCam file upload failed: ${res.status} ${text}`)
  }
}

/**
 * Step 2: Create a clothes virtual try-on task.
 */
export async function createClothVTO(
  srcFileId: string,
  refFileId: string,
  garmentCategory: 'upper_body' | 'lower_body' | 'full_body' | 'outer' | 'shoes' | 'auto' = 'upper_body'
): Promise<string> {
  const res = await fetch(`${getBaseUrl()}/s2s/v2.0/task/cloth-v4`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      src_file_id: srcFileId,
      ref_file_id: refFileId,
      garment_category: garmentCategory,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`YouCam cloth-v4 task creation failed: ${res.status} ${text}`)
  }

  const data: YouCamTaskCreateResponse = await res.json()
  return data.task_id
}

/**
 * Step 3: Poll task status until success or error.
 */
export async function pollTaskStatus(taskId: string): Promise<YouCamTaskStatusResponse> {
  const res = await fetch(`${getBaseUrl()}/s2s/v2.0/task/cloth-v4/${taskId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`YouCam task poll failed: ${res.status} ${text}`)
  }

  return res.json()
}

/**
 * Helper: poll with exponential backoff until task completes.
 * Returns the result image URL or throws on error.
 */
export async function waitForTaskResult(
  taskId: string,
  onStatus?: (status: string) => void
): Promise<string> {
  let delay = 1000
  const maxDelay = 8000
  const maxAttempts = 60 // ~2 minutes max

  for (let i = 0; i < maxAttempts; i++) {
    const status = await pollTaskStatus(taskId)
    onStatus?.(status.task_status)

    if (status.task_status === 'success') {
      const resultUrl =
        status.result?.url ||
        status.result?.image_url ||
        status.result?.download_url
      if (resultUrl) return resultUrl
      throw new Error('YouCam task succeeded but no result URL found')
    }

    if (status.task_status === 'error' || status.task_status === 'failed') {
      throw new Error(`YouCam task failed: ${status.error || 'unknown error'}`)
    }

    // still pending — wait and retry
    await new Promise((resolve) => setTimeout(resolve, delay))
    delay = Math.min(delay * 1.5, maxDelay)
  }

  throw new Error('YouCam task timed out — no result within 2 minutes')
}
