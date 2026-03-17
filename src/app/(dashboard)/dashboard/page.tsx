// 대시보드 - Drizzle 버전 (API 비용 현황 포함)
import { auth } from "@/lib/auth";
import { db } from "@/lib/prisma";
import { projects, sessions, messages } from "@/lib/schema";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import Link from "next/link";

// 30초 캐시: 매번 DB를 조회하지 않고 ISR로 빠르게 응답
export const revalidate = 30;

// Gemini 2.5 Flash 가격 (USD per 1M tokens)
const PRICE_INPUT = 0.15;
const PRICE_OUTPUT = 0.60;
const PRICE_THINKING = 3.50;
const USD_TO_KRW = 1400;

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const recentProjects = await db.select().from(projects)
    .where(and(eq(projects.userId, userId), isNull(projects.deletedAt)))
    .orderBy(desc(projects.updatedAt)).limit(5);

  const recentSessions = await db.select({
    id: sessions.id,
    title: sessions.title,
    status: sessions.status,
    completedAt: sessions.completedAt,
    projectId: sessions.projectId,
  }).from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.status, "completed")))
    .orderBy(desc(sessions.completedAt)).limit(5);

  const projectMap = Object.fromEntries(recentProjects.map((p) => [p.id, p.title]));

  const [totalCountRow] = await db.select({ count: sql<number>`count(*)` }).from(sessions).where(eq(sessions.userId, userId));
  const [completedCountRow] = await db.select({ count: sql<number>`count(*)` }).from(sessions).where(and(eq(sessions.userId, userId), eq(sessions.status, "completed")));

  // 전체 토큰 사용량 집계 (해당 유저의 모든 세션)
  const [tokenTotals] = await db.select({
    totalInput: sql<number>`coalesce(sum(${messages.tokenUsageInput}), 0)`,
    totalOutput: sql<number>`coalesce(sum(${messages.tokenUsageOutput}), 0)`,
    msgCount: sql<number>`count(*)`,
  }).from(messages)
    .innerJoin(sessions, eq(messages.sessionId, sessions.id))
    .where(eq(sessions.userId, userId));

  const totalInput = Number(tokenTotals?.totalInput ?? 0);
  const totalOutput = Number(tokenTotals?.totalOutput ?? 0);
  const apiCallCount = Number(tokenTotals?.msgCount ?? 0);

  // 비용 계산 (입력 + 출력 + thinking 추정)
  // thinking 토큰은 API에서 별도로 집계되지 않으므로, 출력 토큰의 약 3배로 추정
  const estimatedThinking = totalOutput * 3;
  const costInput = (totalInput / 1_000_000) * PRICE_INPUT;
  const costOutput = (totalOutput / 1_000_000) * PRICE_OUTPUT;
  const costThinking = (estimatedThinking / 1_000_000) * PRICE_THINKING;
  const totalCostUSD = costInput + costOutput + costThinking;
  const totalCostKRW = Math.round(totalCostUSD * USD_TO_KRW);

  // 세션별 토큰 사용량 (최근 5개)
  const sessionTokens = await db.select({
    sessionId: messages.sessionId,
    title: sessions.title,
    inputTokens: sql<number>`sum(${messages.tokenUsageInput})`,
    outputTokens: sql<number>`sum(${messages.tokenUsageOutput})`,
    calls: sql<number>`count(*)`,
  }).from(messages)
    .innerJoin(sessions, eq(messages.sessionId, sessions.id))
    .where(eq(sessions.userId, userId))
    .groupBy(messages.sessionId, sessions.title)
    .orderBy(desc(sql`max(${messages.createdAt})`))
    .limit(5);

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">
          안녕하세요, <span className="text-gradient">{session?.user?.name ?? "사용자"}</span>님 👋
        </h1>
        <p className="text-gray-400 mt-1">AI 토론 기획 검토 워크스페이스에 오신 것을 환영합니다.</p>
      </div>

      {/* 상단 통계 카드 */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "전체 프로젝트", value: recentProjects.length, icon: "📁" },
          { label: "전체 세션", value: totalCountRow?.count ?? 0, icon: "💬" },
          { label: "완료된 토론", value: completedCountRow?.count ?? 0, icon: "✅" },
        ].map((stat) => (
          <div key={stat.label} className="glass rounded-2xl p-5 card-hover">
            <div className="text-2xl mb-2">{stat.icon}</div>
            <div className="text-3xl font-bold text-white">{stat.value}</div>
            <div className="text-gray-400 text-sm mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* API 비용 현황 카드 */}
      <div className="glass rounded-2xl p-6 border border-indigo-500/20">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xl">💰</span>
          <h2 className="text-lg font-semibold text-white">API 비용 현황</h2>
          <span className="text-xs text-gray-500 ml-auto">Gemini 2.5 Flash 기준 · 30초마다 갱신</span>
        </div>

        {/* 비용 요약 */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          <div className="bg-white/5 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-500 mb-1">총 API 호출</p>
            <p className="text-xl font-bold text-white">{apiCallCount}<span className="text-xs text-gray-400 ml-1">회</span></p>
          </div>
          <div className="bg-white/5 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-500 mb-1">입력 토큰</p>
            <p className="text-xl font-bold text-cyan-400">{(totalInput / 1000).toFixed(1)}<span className="text-xs text-gray-400 ml-1">K</span></p>
          </div>
          <div className="bg-white/5 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-500 mb-1">출력 토큰</p>
            <p className="text-xl font-bold text-amber-400">{(totalOutput / 1000).toFixed(1)}<span className="text-xs text-gray-400 ml-1">K</span></p>
          </div>
          <div className="bg-white/5 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-500 mb-1">예상 비용</p>
            <p className="text-xl font-bold text-emerald-400">₩{totalCostKRW.toLocaleString()}</p>
            <p className="text-[10px] text-gray-600 mt-0.5">${totalCostUSD.toFixed(4)}</p>
          </div>
        </div>

        {/* 비용 분해 */}
        <div className="bg-white/5 rounded-xl p-4 mb-4">
          <p className="text-xs text-gray-400 mb-2">비용 분해</p>
          <div className="space-y-1.5">
            {[
              { label: "입력", tokens: totalInput, cost: costInput, color: "bg-cyan-500" },
              { label: "출력", tokens: totalOutput, cost: costOutput, color: "bg-amber-500" },
              { label: "Thinking (추정)", tokens: estimatedThinking, cost: costThinking, color: "bg-rose-500" },
            ].map((item) => {
              const pct = totalCostUSD > 0 ? (item.cost / totalCostUSD) * 100 : 0;
              return (
                <div key={item.label} className="flex items-center gap-3 text-xs">
                  <span className="text-gray-400 w-24">{item.label}</span>
                  <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                    <div className={`h-full ${item.color} rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-gray-300 w-16 text-right">₩{Math.round(item.cost * USD_TO_KRW).toLocaleString()}</span>
                  <span className="text-gray-500 w-10 text-right">{pct.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 세션별 사용량 */}
        {sessionTokens.length > 0 && (
          <div>
            <p className="text-xs text-gray-400 mb-2">세션별 사용량 (최근 5개)</p>
            <div className="space-y-2">
              {sessionTokens.map((st) => {
                const inp = Number(st.inputTokens ?? 0);
                const out = Number(st.outputTokens ?? 0);
                const estThink = out * 3;
                const cost = ((inp / 1e6) * PRICE_INPUT + (out / 1e6) * PRICE_OUTPUT + (estThink / 1e6) * PRICE_THINKING) * USD_TO_KRW;
                return (
                  <Link
                    key={st.sessionId}
                    href={`/sessions/${st.sessionId}`}
                    className="flex items-center justify-between p-3 rounded-xl bg-white/5 hover:bg-white/10 transition text-xs group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-200 truncate group-hover:text-white">{st.title}</p>
                      <p className="text-gray-500 mt-0.5">
                        {Number(st.calls)}회 호출 · 입력 {(inp / 1000).toFixed(1)}K · 출력 {(out / 1000).toFixed(1)}K
                      </p>
                    </div>
                    <span className="text-emerald-400 font-medium ml-3">₩{Math.round(cost).toLocaleString()}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* 가격 안내 */}
        <div className="mt-4 pt-3 border-t border-white/5 text-[10px] text-gray-600">
          💡 가격 기준: 입력 $0.15/1M · 출력 $0.60/1M · Thinking $3.50/1M (추정치) · $1=₩1,400
        </div>
      </div>

      {/* 최근 프로젝트 / 토론 */}
      <div className="grid grid-cols-2 gap-6">
        <div className="glass rounded-2xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-white">최근 프로젝트</h2>
            <Link href="/projects" className="text-indigo-400 hover:text-indigo-300 text-sm">전체 보기 →</Link>
          </div>
          {recentProjects.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 text-sm">프로젝트가 없습니다.</p>
              <Link href="/projects" className="mt-3 inline-block text-sm text-indigo-400">첫 프로젝트 만들기 →</Link>
            </div>
          ) : (
            <div className="space-y-3">
              {recentProjects.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition group">
                  <div>
                    <p className="text-sm font-medium text-gray-200 group-hover:text-white">{p.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{new Date(p.createdAt!).toLocaleDateString("ko-KR")}</p>
                  </div>
                  <span className="text-gray-600 group-hover:text-gray-400 text-sm">→</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="glass rounded-2xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-white">최근 완료 토론</h2>
            <Link href="/history" className="text-indigo-400 hover:text-indigo-300 text-sm">전체 보기 →</Link>
          </div>
          {recentSessions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 text-sm">완료된 토론이 없습니다.</p>
              <p className="text-xs text-gray-600 mt-1">기획안을 입력하고 AI 토론을 시작해보세요!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentSessions.map((s) => (
                <Link key={s.id} href={`/sessions/${s.id}`} className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition group">
                  <div>
                    <p className="text-sm font-medium text-gray-200 group-hover:text-white">{s.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {projectMap[s.projectId] ?? ""} · {s.completedAt ? new Date(s.completedAt).toLocaleDateString("ko-KR") : ""}
                    </p>
                  </div>
                  <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">완료</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
