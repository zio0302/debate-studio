/**
 * 어드민 계정 생성 스크립트
 * 실행: node scripts/create-admin.cjs
 */
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

async function createAdmin() {
  const client = new Client({
    connectionString: 'postgresql://postgres.ayqytnapykryltqvhumw:dltnstls!34@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres',
  });

  try {
    await client.connect();
    console.log('DB 연결 성공');

    // 비밀번호 해싱
    const hashedPassword = await bcrypt.hash('dltnstls!34', 12);
    console.log('비밀번호 해싱 완료');

    // 어드민 계정 생성 (이미 있으면 업데이트)
    const result = await client.query(`
      INSERT INTO users (email, name, password, created_at, updated_at)
      VALUES ('admin@admin.com', '관리자', $1, NOW(), NOW())
      ON CONFLICT (email)
      DO UPDATE SET password = $1, name = '관리자', updated_at = NOW()
      RETURNING id, email, name, created_at
    `, [hashedPassword]);

    console.log('✅ 어드민 계정 생성 완료!');
    console.log('  이메일: admin@admin.com');
    console.log('  비밀번호: dltnstls!34');
    console.log('  ID:', result.rows[0].id);
  } catch (err) {
    console.error('❌ 오류:', err.message);
  } finally {
    await client.end();
  }
}

createAdmin();
