import type { Metadata } from 'next';
import LandingPageClient from './LandingPageClient';

export const metadata: Metadata = {
  title: 'Buuga Xisaabta - Nidaamka Maamulka Ganacsiga & Maqalka',
  description:
    'Buuga Xisaabta waa nidaam casri ah oo lagu maamulo xisaabaadka ganacsiga, maqalka, daymaha, iyo lacagaha. Hel warbixinta xisaabta maalinlaha ah si fudud.',
  alternates: { canonical: 'https://www.buugaxisaabta.online' },
};

export default function LandingPage() {
  return <LandingPageClient />;
}
