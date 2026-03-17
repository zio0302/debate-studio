# Debate Studio 🎯

AI 토론형 기획안 검토 서비스 — 두 AI 페르소나가 기획안을 검토하고 Moderator가 최종 기획안을 도출합니다.

## 🚀 빠른 시작

### 1. 필요한 계정
- [Supabase](https://supabase.com) — 무료 PostgreSQL DB
- [Google AI Studio](https://ai.google.dev) — Gemini API 키
- [Vercel](https://vercel.com) — 배포 (GitHub 연동)

### 2. 로컬 개발 환경 설정

```bash
# 의존성 설치
npm install

# 환경변수 설정
cp .env.example .env.local
# .env.local 파일 열어서 값 입력

# DB 스키마 생성 (Supabase 연결 후)
npx drizzle-kit push

# 개발 서버 시작
npm run dev
```

### 3. 환경변수 (.env.local)

| 변수명 | 설명 | 발급처 |
|---|---|---|
| `DATABASE_URL` | Supabase PostgreSQL 연결 문자열 | Supabase > Settings > Database |
| `GEMINI_API_KEY` | Gemini AI API 키 | ai.google.dev |
| `NEXTAUTH_SECRET` | JWT 암호화 키 (랜덤 32자+) | 직접 생성 |
| `NEXTAUTH_URL` | 서비스 URL | 로컬: `http://localhost:3000` |

## 🗄️ DB 마이그레이션

```bash
# 스키마 변경 시 Supabase에 적용
npx drizzle-kit push

# 마이그레이션 파일 생성 (선택)
npx drizzle-kit generate
```

## 📦 기술 스택

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS
- **Backend**: Next.js Route Handlers
- **DB**: Supabase PostgreSQL + Drizzle ORM
- **AI**: Google Gemini API
- **Auth**: NextAuth.js (JWT)
- **Deploy**: Vercel

## 🌐 Vercel 배포

1. GitHub에 코드 push
2. [Vercel](https://vercel.com)에서 레포 연결
3. Environment Variables에 `.env.local` 값 입력
4. `NEXTAUTH_URL`을 Vercel 도메인으로 변경 (예: `https://debate-studio.vercel.app`)
5. 자동 배포 완료 🚀
