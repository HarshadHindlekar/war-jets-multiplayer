'use client'
import dynamic from 'next/dynamic'

const Game = dynamic(() => import('@/components/Game'), {
  ssr: false,
  loading: () => (
    <div className="w-screen h-screen flex flex-col items-center justify-center bg-[#050a14] gap-4">
      <div style={{ fontFamily: 'monospace', color: '#00d4ff', fontSize: 28, letterSpacing: '0.3em' }}>WAR JETS</div>
      <div style={{ fontFamily: 'monospace', color: '#00ff41', fontSize: 13, letterSpacing: '0.2em' }} className="animate-pulse">LOADING...</div>
    </div>
  ),
})

export default function Home() {
  return <main className="w-screen h-screen overflow-hidden"><Game /></main>
}
