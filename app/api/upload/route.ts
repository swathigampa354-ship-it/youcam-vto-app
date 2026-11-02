import { NextRequest, NextResponse } from 'next/server'
import { registerFileUpload, uploadFileBytes } from '@/lib/youcam'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { fileName, contentType, fileData } = body

    if (!fileName || !contentType || !fileData) {
      return NextResponse.json(
        { error: 'Missing required fields: fileName, contentType, fileData' },
        { status: 400 }
      )
    }

    // Step 1: Register file with YouCam to get presigned upload URL
    const { fileId, uploadUrl } = await registerFileUpload(fileName, contentType)

    // Step 2: Upload bytes to the presigned URL
    const buffer = Buffer.from(fileData, 'base64')
    await uploadFileBytes(uploadUrl, buffer, contentType)

    return NextResponse.json({ fileId })
  } catch (err) {
    console.error('YouCam upload error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    )
  }
}
