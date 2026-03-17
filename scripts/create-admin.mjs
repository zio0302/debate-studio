/**
 * 어드민 계정 생성 스크립트 (postgres.js 사용)
 */
import postgres from 'postgres';
import bcrypt from 'bcryptjs';

const sql = postgres(
  'postgresql://postgres.ayqytnapykryltqvhumw:dltnstls!34@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres',
  { prepare: false }
);

async function createAdmin() {
  try {
    const hashedPassword = await bcrypt.hash('dltnstls!34', 12);
    console.log('비밀번호 해싱 완료');

    const [row] = await sql`
      INSERT INTO users (email, name, password, created_at, updated_at)
      VALUES ('admin@admin.com', '관리자', ${hashedPassword}, NOW(), NOW())
      ON CONFLICT (email)
      DO UPDATE SET password = ${hashedPassword}, name = '관리자', updated_at = NOW()
      RETURNING id, email, name
    `;

    console.log('✅ 어드민 계정 생성 완료!');
    console.log('  이메일: admin@admin.com');
    console.log('  비밀번호: dltnstls!34');
    console.log('  ID:', row.id);
  } catch (err) {
    console.error('❌ 오류:', err.message);
  } finally {
    await sql.end();
  }
}

createAdmin();
