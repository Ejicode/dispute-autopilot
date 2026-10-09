import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { Dispute, DemoOrder } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();

  // 1. Fetch all disputes & orders from SQLite
  const disputes = db.prepare('SELECT * FROM disputes ORDER BY created_at DESC').all() as Dispute[];
  const orders = db.prepare('SELECT * FROM demo_orders ORDER BY created_at DESC').all() as DemoOrder[];
  const evidenceCount = (db.prepare('SELECT count(*) as count FROM evidence_items').get() as any)?.count ?? 0;
  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as any[];

  // 2. High-level KPIs — always computed from real Date.now()
  const now = Date.now();
  const in48Hours = now + 48 * 3600 * 1000;

  let totalAtRiskCents = 0;
  let recoveredCents = 0;
  let expiring48hCount = 0;
  let requiredActionCount = 0;
  let wonCount = 0;

  for (const d of disputes) {
    if (d.status === 'REQUIRED_ACTION' || d.status === 'UNDER_REVIEW') {
      totalAtRiskCents += d.amount_cents;
      requiredActionCount++;
      const deadlineMs = new Date(d.response_deadline).getTime();
      if (deadlineMs <= in48Hours && deadlineMs >= now) {
        expiring48hCount++;
      }
    } else if (d.status === 'RESOLVED') {
      recoveredCents += d.amount_cents;
      if (d.outcome === 'WON' || d.recommendation === 'FIGHT') {
        wonCount++;
      }
    }
  }

  const resolvedCount = disputes.filter((d) => d.status === 'RESOLVED').length;
  // Win rate: percentage of resolved disputes with favourable outcome
  const winRate = resolvedCount > 0
    ? Math.round((wonCount / resolvedCount) * 100)
    : disputes.length > 0
      ? Math.round(((disputes.length - requiredActionCount) / disputes.length) * 100)
      : 0;

  // Average response time: time from dispute creation to first resolution (hours)
  const resolvedWithTimes = disputes.filter(
    (d) => d.status === 'RESOLVED' && d.created_at && d.updated_at
  );
  let avgResponseHours = 0;
  if (resolvedWithTimes.length > 0) {
    const totalHours = resolvedWithTimes.reduce((sum, d) => {
      const diffMs = new Date(d.updated_at).getTime() - new Date(d.created_at).getTime();
      return sum + diffMs / (1000 * 60 * 60);
    }, 0);
    avgResponseHours = Math.round((totalHours / resolvedWithTimes.length) * 10) / 10;
  } else {
    // For active disputes: time from creation to now
    const activeTimes = disputes.filter((d) => d.created_at);
    if (activeTimes.length > 0) {
      const totalHours = activeTimes.reduce((sum, d) => {
        const diffMs = Date.now() - new Date(d.created_at).getTime();
        return sum + diffMs / (1000 * 60 * 60);
      }, 0);
      avgResponseHours = Math.round((totalHours / activeTimes.length) * 10) / 10;
    }
  }

  // Total protected GMV: sum of all order values
  const totalProtectedCents = orders.reduce((sum, o) => sum + (o.total_cents || 0), 0);

  const distinctCustomers = (db.prepare('SELECT count(DISTINCT buyer_email) as count FROM demo_orders').get() as any)?.count ?? 0;
  const orderCount = orders.length;

  // 3. Real Category Breakdown for Donut Chart
  const reasonMap: Record<string, { count: number; amount_cents: number }> = {};
  for (const d of disputes) {
    if (!reasonMap[d.reason]) {
      reasonMap[d.reason] = { count: 0, amount_cents: 0 };
    }
    reasonMap[d.reason].count++;
    reasonMap[d.reason].amount_cents += d.amount_cents;
  }

  const colorPalette = ['#0070BA', '#003087', '#009CDE', '#FFC439', '#475569'];
  const labels: Record<string, string> = {
    MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Item Not Received (INR)',
    MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not As Described (SNAD)',
    UNAUTHORISED: 'Unauthorised Transaction',
    INCORRECT_AMOUNT: 'Incorrect Amount Charged',
    DUPLICATE_TRANSACTION: 'Duplicate Charge',
  };

  const donutCategories = Object.entries(reasonMap).map(([reason, stats], idx) => {
    const totalCount = disputes.length || 1;
    return {
      reason,
      name: labels[reason] || reason.replace(/_/g, ' '),
      value: stats.count,
      amount: stats.amount_cents / 100,
      percentage: Math.round((stats.count / totalCount) * 100),
      color: colorPalette[idx % colorPalette.length],
    };
  });

  if (donutCategories.length === 0) {
    donutCategories.push({
      reason: 'NO_DISPUTES',
      name: 'No Disputes Yet',
      value: 1,
      amount: 0,
      percentage: 100,
      color: '#0070BA',
    });
  }

  // 4. Dynamic Wave Chart Timeline — last 8 days from now
  const nowDate = new Date();
  const last8Days = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(nowDate);
    d.setDate(d.getDate() - (7 - i));
    const fullDate = d.toISOString().slice(0, 10); // YYYY-MM-DD
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { label, fullDate };
  });

  let cumulativeProtected = 0;
  let cumulativeDisputed = 0;

  const wavePoints = last8Days.map((day) => {
    const dayOrders = orders.filter((o) => o.created_at?.startsWith(day.fullDate));
    const dayDisputes = disputes.filter((d) => d.created_at?.startsWith(day.fullDate));

    for (const o of dayOrders) cumulativeProtected += (o.total_cents || 0) / 100;
    for (const d of dayDisputes) cumulativeDisputed += (d.amount_cents || 0) / 100;

    return {
      date: day.label,
      disputed: Math.round(cumulativeDisputed),
      protectedVolume: Math.round(cumulativeProtected),
      atRisk: Math.round(totalAtRiskCents / 100),
    };
  });

  // 5. Dynamic calendar — current week (Mon–Sun)
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);

  const calendarDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const fullDate = d.toISOString().slice(0, 10);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const isToday = fullDate === today.toISOString().slice(0, 10);
    const disputeCount = disputes.filter((disp) => disp.response_deadline?.startsWith(fullDate)).length;
    return {
      dayName: dayNames[d.getDay()],
      dateNumber: d.getDate(),
      fullDate,
      isToday,
      disputeCount,
    };
  });

  const activeDayIdx = calendarDays.findIndex((c) => c.isToday);
  const monthLabel = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // 6. Evidence Coverage Breakdown
  const primaryStoreName = users[0]?.store_name || 'Your Store';
  const totalRequired = disputes.length * 3 || 1;
  const coverageRate = Math.min(100, Math.round((evidenceCount / totalRequired) * 100));

  const storeBreakdowns = [
    {
      storeName: `${primaryStoreName} / Order Payment Receipts`,
      percentage: orderCount > 0 ? 100 : 0,
      count: evidenceCount,
      color: '#0070BA',
    },
    {
      storeName: `${primaryStoreName} / Carrier Tracking`,
      percentage: orderCount > 0 ? 100 : 0,
      count: orderCount,
      color: '#003087',
    },
    {
      storeName: `${primaryStoreName} / Proof of Delivery`,
      percentage: Math.min(100, Math.round(coverageRate * 0.95)),
      count: evidenceCount,
      color: '#009CDE',
    },
  ];

  return NextResponse.json({
    kpis: {
      customerCount: distinctCustomers,
      orderCount,
      totalAtRiskCents,
      recoveredCents,
      expiring48hCount,
      requiredActionCount,
      totalDisputes: disputes.length,
      evidenceCount,
      coverageRate,
      winRate,
      avgResponseHours,
      totalProtectedCents,
    },
    donutCategories,
    wavePoints,
    calendar: {
      monthLabel,
      days: calendarDays,
      activeDayIdx: activeDayIdx >= 0 ? activeDayIdx : 3,
    },
    storeBreakdowns,
    merchantCount: users.length,
  });
}
