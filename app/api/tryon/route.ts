import { NextRequest, NextResponse } from 'next/server'
import { registerFileUpload, uploadFileBytes, createClothVTO } from '@/lib/youcam'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const imageFile = formData.get('image') as File | null
    const garmentFile = formData.get('garment') as File | null

    if (!imageFile) {
      return NextResponse.json({ error: 'Missing image field' }, { status: 400 })
    }
    if (!garmentFile) {
      return NextResponse.json({ error: 'Missing garment field' }, { status: 400 })
    }

    // Upload source image (webcam frame) to YouCam
    const srcReg = await registerFileUpload(imageFile.name, imageFile.type)
    const srcBuffer = await imageFile.arrayBuffer()
    await uploadFileBytes(srcReg.uploadUrl, srcBuffer, imageFile.type)

    // Upload reference image (garment) to YouCam
    const refReg = await registerFileUpload(garmentFile.name, garmentFile.type)
    const refBuffer = await garmentFile.arrayBuffer()
    await uploadFileBytes(refReg.uploadUrl, refBuffer, garmentFile.type)

    // Create cloth-v4 task
    const taskId = await createClothVTO(srcReg.fileId, refReg.fileId, 'upper_body')

    return NextResponse.json({ taskId })
  } catch (err) {
    console.error('YouCam try-on error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Try-on task creation failed' },
      { status: 500 }
    )
  }
}
