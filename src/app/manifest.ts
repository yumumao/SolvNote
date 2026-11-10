import type { MetadataRoute } from 'next'
import { APP_NAME, APP_DESCRIPTION } from '@/lib/app-info'

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: APP_NAME,
        short_name: '解迹',
        description: APP_DESCRIPTION,
        id: '/',
        start_url: '/',
        scope: '/',
        lang: 'zh-CN',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#38bdf8',
        orientation: 'portrait',
        icons: [
            { src: '/icons/install-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/install-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icons/install-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            {
                src: '/icons/icon.svg',
                sizes: 'any',
                type: 'image/svg+xml',
            },
        ],
    }
}
