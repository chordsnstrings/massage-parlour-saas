'use client'
import { useEffect } from 'react'
import { mountScenes } from '@/lib/scroll-scenes'
import '@/lib/scenes'

/** Drives every [data-scene] on the page from scroll position (see lib/scroll-scenes.ts). */
export function ScrollScenes() {
  useEffect(() => mountScenes(), [])
  return null
}
