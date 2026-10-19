import CaseDetailClient from './CaseDetailClient';

// The app is exported as a static SPA. Only a single placeholder shell is
// emitted for this dynamic segment; the Go server serves that shell for any
// /case/<id> deep link and the client resolves the real id from the URL.
export function generateStaticParams() {
  return [{ id: '_' }];
}

export default function CaseDetailPage() {
  return <CaseDetailClient />;
}
