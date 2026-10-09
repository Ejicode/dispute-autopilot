import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDb, recordAuditLog } from '@/lib/db';
import { realtimeHub } from '@/lib/realtime/hub';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json().catch(() => ({}));
  const { name, email, store_name, avatar_url } = body;

  if (!name || !email || !store_name) {
    return NextResponse.json(
      { error: 'Name, email, and store_name are all required to create a merchant account.' },
      { status: 400 }
    );
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (existing) {
    return NextResponse.json(
      { error: 'An account with this email address already exists.' },
      { status: 409 }
    );
  }

  // Curated list of high quality avatars if none provided
  const fallbackAvatars = [
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=256&q=80',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=256&q=80',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=256&q=80',
    'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=256&q=80',
    'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=256&q=80',
  ];
  const chosenAvatar = (avatar_url && avatar_url.trim()) 
    ? avatar_url.trim() 
    : fallbackAvatars[Math.floor(Math.random() * fallbackAvatars.length)];

  const userId = 'usr_' + crypto.randomBytes(6).toString('hex');
  const createdAt = new Date().toISOString();

  const insertQuery = 'INSERT INTO users (id, name, email, store_name, role, avatar_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)';
  db.prepare(insertQuery).run(
    userId,
    name.trim(),
    email.trim().toLowerCase(),
    store_name.trim(),
    'MERCHANT_ADMIN',
    chosenAvatar,
    createdAt
  );

  const newUser = {
    id: userId,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    store_name: store_name.trim(),
    role: 'MERCHANT_ADMIN',
    avatar_url: chosenAvatar,
    created_at: createdAt,
  };

  recordAuditLog('user', 'MERCHANT_ACCOUNT_CREATED', {
    userId,
    name: newUser.name,
    store_name: newUser.store_name,
    avatar_url: newUser.avatar_url,
  });

  realtimeHub.emit('event', {
    id: 'evt_' + Date.now(),
    type: 'USER_REGISTERED',
    timestamp: createdAt,
    payload: newUser,
  });

  return NextResponse.json({ success: true, user: newUser });
}
