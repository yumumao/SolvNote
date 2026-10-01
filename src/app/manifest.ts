import type { MetadataRoute } from 'next'
import { APP_NAME, APP_DESCRIPTION } from '@/lib/app-info'

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: APP_NAME,
        short_name: '解迹',
        description: APP_DESCRIPTION,
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#38bdf8',
        orientation: 'portrait',
        icons: [
            {
                src: '/icons/icon.svg',
                sizes: 'any',
                type: 'image/svg+xml',
            },
        ],
    }
}
