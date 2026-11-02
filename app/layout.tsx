import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'YouCam Live VTO — Real-Time Clothes Try-On',
  description: 'Live webcam try-on with MediaPipe Pose overlay + YouCam AI photorealistic render. Built for the YouCam API VTO Hackathon.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
