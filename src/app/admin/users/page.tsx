import Link from "next/link";
import { UserManagement } from "@/components/admin/user-management";
/** Middleware enforces the current live administrator session before rendering. */
export default function UserAdministrationPage() {
    return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <nav className="flex flex-wrap gap-4 text-sm underline"><Link href="/admin">返回管理中心 / Admin</Link><Link href="/admin/ai">站点AI设置 / Site AI</Link><Link href="/">首页 / Home</Link></nav>
        <UserManagement />
    </main>;
}
