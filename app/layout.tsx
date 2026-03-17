import type { Metadata } from 'next'
import './globals.css'
export const metadata: Metadata = { title: 'WAR JETS — P2P Multiplayer', description: 'Browser P2P multiplayer jet combat' }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>
}
