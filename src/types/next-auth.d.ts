import { DefaultSession } from "next-auth"

declare module "next-auth" {
    interface Session {
        user: {
            id: string
            role?: string
            sessionVersion?: number
            mustChangePassword?: boolean
        } & DefaultSession["user"]
    }

    interface User {
        role?: string
            sessionVersion?: number
            mustChangePassword?: boolean
        isActive?: boolean
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        invalidSession?: boolean
        id: string
        role?: string
            sessionVersion?: number
            mustChangePassword?: boolean
    }
}
