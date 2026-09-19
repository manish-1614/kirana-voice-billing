import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { createNewSession, getOrCreateActiveSession } from '@/lib/tool-dispatcher';

export async function GET(req: NextRequest) {
  const supabase = getServerSupabase();
  const todayIST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

  if (!supabase) {
    return NextResponse.json({
      sessions: [
        {
          id: 'mock-session-001',
          customer_number: 1,
          session_date: todayIST,
          status: 'open',
          subtotal: 0,
        },
      ],
    });
  }

  const { data: sessions, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('session_date', todayIST)
    .order('customer_number', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sessions: sessions || [] });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'create';

    if (action === 'create') {
      const newSession = await createNewSession();
      return NextResponse.json({ session: newSession });
    }

    if (action === 'get_active') {
      const active = await getOrCreateActiveSession(body.sessionId);
      return NextResponse.json({ session: active });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
