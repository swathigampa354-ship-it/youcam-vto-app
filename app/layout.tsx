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
      <body className={inter.className}>
        <script
          type="importmap"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              imports: {
                '@mediapipe/tasks-vision':
                  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/+esm/index.mjs',
              },
            }),
          }}
        />
        {children}
      </body>
    </html>
  )
}
