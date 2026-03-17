"use client";
// 사이드바 네비게이션 컴포넌트
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

interface SidebarProps {
  user?: { name?: string | null; email?: string | null };
}

const navItems = [
  { href: "/directive", label: "상위 지침", icon: "📌" },
  { href: "/dashboard", label: "대시보드", icon: "🏠" },
  { href: "/projects", label: "프로젝트", icon: "📁" },
  { href: "/history", label: "히스토리", icon: "📋" },
  { href: "/settings", label: "설정", icon: "⚙️" },
];

export default function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="w-64 flex-shrink-0 glass border-r border-white/10 flex flex-col">
      {/* 로고 */}
      <div className="p-6 border-b border-white/10">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="text-2xl">⚡</span>
          <span className="text-lg font-bold text-gradient">Debate Studio</span>
        </Link>
      </div>

      {/* 새 토론 시작 버튼 */}
      <div className="p-4">
        <Link
          href="/projects"
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl
                     bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition"
        >
          <span>+</span> 새 토론 시작
        </Link>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 px-3 py-2 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition
                ${isActive
                  ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30"
                  : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* 사용자 정보 + 로그아웃 */}
      <div className="p-4 border-t border-white/10">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-indigo-600/30 flex items-center justify-center text-sm font-medium text-indigo-300">
            {user?.name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? "U"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-200 truncate">{user?.name ?? "사용자"}</p>
            <p className="text-xs text-gray-500 truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full text-xs text-gray-500 hover:text-gray-300 text-left py-1 transition"
        >
          로그아웃
        </button>
      </div>
    </aside>
  );
}
