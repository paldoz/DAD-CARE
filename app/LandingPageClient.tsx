'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

// ── Scroll-reveal hook ────────────────────────────────────────────────────
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, visible };
}

// ── Data ─────────────────────────────────────────────────────────────────
const features = [
  { icon: '📒', title: 'Buugga Maalinlaha', desc: 'Duubi dakhliga iyo kharashka maalin walba si taxaddar leh. Hel kooxayn buuxda markii aad u baahantahay.', color: 'rgba(99,102,241,0.15)', border: 'rgba(99,102,241,0.35)', glow: 'rgba(99,102,241,0.4)' },
  { icon: '👥', title: 'Xisaabaadka Macaamiisha', desc: 'Raac daymaha macaamiisha, lacagaha la bixiyey, iyo taariikhda macaamiil kasta hal meel.', color: 'rgba(139,92,246,0.15)', border: 'rgba(139,92,246,0.35)', glow: 'rgba(139,92,246,0.4)' },
  { icon: '💳', title: 'Maqalka & Lacag Bixinta', desc: 'Maaree lacag bixinta iyo maqalka si sahlan — xisaab kasta lagu daabi karaa oo la xaqiijin karo.', color: 'rgba(56,189,248,0.12)', border: 'rgba(56,189,248,0.3)', glow: 'rgba(56,189,248,0.35)' },
  { icon: '📊', title: 'Warbixinnada Xisaabaadka', desc: 'Hel warbixinno dhammaystiran oo ku saabsan xaalada maaliyadeed ganacsigaaga — mar kasta.', color: 'rgba(52,211,153,0.12)', border: 'rgba(52,211,153,0.3)', glow: 'rgba(52,211,153,0.35)' },
  { icon: '🔒', title: 'Ammaan & Kalsoonaan', desc: 'Xogta ganacsigaaga waxay ku amaan tahay nidaam sireed oo casri ah — gelitaan xaddidan.', color: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.3)', glow: 'rgba(251,191,36,0.35)' },
  { icon: '⚡', title: "Degdeg & Faa'iido", desc: "Nidaam degdeg ah oo shaqeeyaa telefoonka, kombiyuutarka, iyo tablet-ka — xiriir kasta.", color: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)', glow: 'rgba(239,68,68,0.3)' },
];

const stats = [
  { value: '100%', label: 'Aamin', sub: 'Xog Sugnaanta' },
  { value: '24/7', label: 'La Heli Karo', sub: 'Waqti Kasta' },
  { value: '0', label: 'Khasaare', sub: 'Xog Lumay' },
  { value: 'PWA', label: 'App', sub: 'Phone & Desktop' },
];

const steps = [
  { num: '01', title: 'Gal Nidaamka', desc: 'Isticmaal magacaaga iyo furaha sirta si aad u gasho xisaabaadkaaga.' },
  { num: '02', title: 'Ku Dar Macaamiisha', desc: 'Abuur xisaab macaamiil kasta oo raac daymaha iyo lacagaha.' },
  { num: '03', title: 'Raac Xisaabaadka', desc: 'Dakhli, kharash, iyo maqal — wax walba hal meel.' },
  { num: '04', title: 'Hel Warbixinta', desc: 'Daabac ama soo deji warbixin kasta marka aad u baahato.' },
];

// ── Lightning beams ───────────────────────────────────────────────────────
function LightningLayer({ opacity = 0.35 }: { opacity?: number }) {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', opacity }}>
      <div style={{ position: 'absolute', top: '-20%', left: '18%', width: 2, height: '150%', background: 'linear-gradient(to bottom, transparent, #818cf8 40%, transparent)', transform: 'rotate(18deg)', filter: 'blur(1px)', animation: 'lp-pulse 4s ease-in-out infinite' }} />
      <div style={{ position: 'absolute', top: '-20%', left: '18%', width: 40, height: '150%', background: 'rgba(99,102,241,0.07)', transform: 'rotate(18deg)', filter: 'blur(22px)' }} />
      <div style={{ position: 'absolute', top: '25%', left: '58%', width: 1, height: '80%', background: 'linear-gradient(to bottom, transparent, #93c5fd 40%, transparent)', transform: 'rotate(38deg)', filter: 'blur(1px)', animation: 'lp-pulse 5s ease-in-out 1.2s infinite' }} />
      <div style={{ position: 'absolute', top: '25%', left: '58%', width: 24, height: '80%', background: 'rgba(56,189,248,0.07)', transform: 'rotate(38deg)', filter: 'blur(16px)' }} />
      <div style={{ position: 'absolute', top: '35%', right: '12%', width: 1, height: '100%', background: 'linear-gradient(to bottom, transparent, #c4b5fd 40%, transparent)', transform: 'rotate(-22deg)', filter: 'blur(1px)', animation: 'lp-lightning 6.5s infinite' }} />
      <div style={{ position: 'absolute', top: '35%', right: '12%', width: 55, height: '100%', background: 'rgba(139,92,246,0.05)', transform: 'rotate(-22deg)', filter: 'blur(28px)', animation: 'lp-lightning 6.5s infinite' }} />
    </div>
  );
}

// ── Feature card ─────────────────────────────────────────────────────────
function FeatureCard({ f, delay }: { f: typeof features[0]; delay: number }) {
  const { ref, visible } = useReveal();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      ref={ref}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '1.75rem',
        borderRadius: 20,
        background: hovered ? f.color : 'rgba(255,255,255,0.035)',
        border: `1px solid ${hovered ? f.border : 'rgba(255,255,255,0.07)'}`,
        backdropFilter: 'blur(12px)',
        transition: 'all 0.32s cubic-bezier(0.4,0,0.2,1)',
        transform: visible ? (hovered ? 'translateY(-6px) scale(1.01)' : 'translateY(0)') : 'translateY(28px)',
        opacity: visible ? 1 : 0,
        transitionDelay: `${delay}ms`,
        cursor: 'default',
        boxShadow: hovered ? `0 20px 50px ${f.color}` : 'none',
      }}
    >
      <div style={{
        width: 52, height: 52, borderRadius: 14,
        background: f.color, border: `1px solid ${f.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.5rem', marginBottom: '1.1rem',
        boxShadow: hovered ? `0 0 28px ${f.glow}` : 'none',
        transition: 'box-shadow 0.3s',
      }}>
        {f.icon}
      </div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: '0.55rem', color: '#f1f5f9' }}>{f.title}</h3>
      <p style={{ color: 'rgba(248,250,252,0.5)', fontSize: '0.9rem', lineHeight: 1.7 }}>{f.desc}</p>
    </div>
  );
}

// ── Step card ─────────────────────────────────────────────────────────────
function StepCard({ step, delay }: { step: typeof steps[0]; delay: number }) {
  const { ref, visible } = useReveal();
  return (
    <div ref={ref} style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', opacity: visible ? 1 : 0, transform: visible ? 'translateX(0)' : 'translateX(-24px)', transition: `all 0.55s cubic-bezier(0.4,0,0.2,1) ${delay}ms` }}>
      <div style={{ flexShrink: 0, width: 50, height: 50, borderRadius: '50%', background: 'linear-gradient(135deg, rgba(99,102,241,0.28), rgba(139,92,246,0.18))', border: '1px solid rgba(99,102,241,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '0.82rem', color: '#818cf8', boxShadow: '0 0 20px rgba(99,102,241,0.2)' }}>
        {step.num}
      </div>
      <div style={{ paddingTop: '0.15rem' }}>
        <h3 style={{ fontWeight: 800, fontSize: '1.05rem', color: '#f1f5f9', marginBottom: '0.35rem' }}>{step.title}</h3>
        <p style={{ color: 'rgba(248,250,252,0.5)', fontSize: '0.9rem', lineHeight: 1.65 }}>{step.desc}</p>
      </div>
    </div>
  );
}

// ── Stat block ────────────────────────────────────────────────────────────
function StatBlock({ stat, delay }: { stat: typeof stats[0]; delay: number }) {
  const { ref, visible } = useReveal();
  return (
    <div ref={ref} style={{ textAlign: 'center', opacity: visible ? 1 : 0, transform: visible ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.9)', transition: `all 0.6s cubic-bezier(0.34,1.56,0.64,1) ${delay}ms` }}>
      <div style={{ fontSize: 'clamp(1.9rem, 4vw, 3rem)', fontWeight: 900, background: 'linear-gradient(135deg, #818cf8, #c084fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', lineHeight: 1, letterSpacing: '-0.03em' }}>{stat.value}</div>
      <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#e2e8f0', marginTop: '0.4rem' }}>{stat.label}</div>
      <div style={{ fontSize: '0.7rem', color: 'rgba(248,250,252,0.32)', marginTop: '0.15rem', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{stat.sub}</div>
    </div>
  );
}

// ── Mock dashboard visual ─────────────────────────────────────────────────
function HowVisual() {
  const { ref, visible } = useReveal();
  return (
    <div ref={ref} style={{ position: 'relative', borderRadius: 24, overflow: 'hidden', background: 'linear-gradient(145deg, #0a0f1e, #161040)', border: '1px solid rgba(99,102,241,0.22)', padding: '2.25rem', boxShadow: '0 32px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(99,102,241,0.1)', opacity: visible ? 1 : 0, transform: visible ? 'translateY(0) scale(1)' : 'translateY(32px) scale(0.97)', transition: 'all 0.7s cubic-bezier(0.4,0,0.2,1)' }}>
      <LightningLayer opacity={0.18} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* Browser bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '1.5rem' }}>
          {['#ef4444','#f59e0b','#10b981'].map(c => <div key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c, opacity: 0.8 }} />)}
          <div style={{ flex: 1, marginLeft: '0.5rem', height: 22, borderRadius: 6, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', paddingLeft: '0.6rem' }}>
            <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.28)' }}>buugaxisaabta.online/dashboard</span>
          </div>
        </div>
        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.6rem', marginBottom: '1.1rem' }}>
          {[{ l: 'Dakhli', v: '$1,240', c: '#10b981' }, { l: 'Kharash', v: '$380', c: '#f87171' }, { l: "Faa'iido", v: '$860', c: '#818cf8' }].map(r => (
            <div key={r.l} style={{ padding: '0.7rem', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
              <div style={{ fontSize: '0.63rem', color: 'rgba(255,255,255,0.38)', fontWeight: 600, marginBottom: '0.3rem' }}>{r.l}</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: r.c }}>{r.v}</div>
            </div>
          ))}
        </div>
        {/* Customer rows */}
        <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.28)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Macaamiisha</div>
        {[{ n: 'Axmed Cali', a: '$200', paid: true }, { n: 'Faadumo Warsame', a: '$150', paid: false }, { n: 'Maxamed Xirsi', a: '$320', paid: true }].map(c => (
          <div key={c.n} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.75rem', borderRadius: 9, background: 'rgba(255,255,255,0.025)', marginBottom: '0.45rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 800, color: '#fff', flexShrink: 0 }}>{c.n[0]}</div>
              <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.62)', fontWeight: 600 }}>{c.n}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f1f5f9' }}>{c.a}</span>
              <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '0.18rem 0.45rem', borderRadius: 999, background: c.paid ? 'rgba(16,185,129,0.14)' : 'rgba(239,68,68,0.14)', color: c.paid ? '#10b981' : '#f87171', border: `1px solid ${c.paid ? 'rgba(16,185,129,0.28)' : 'rgba(239,68,68,0.28)'}` }}>{c.paid ? 'Bixi' : 'Dayn'}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', bottom: -40, left: '50%', transform: 'translateX(-50%)', width: 280, height: 120, background: 'radial-gradient(ellipse, rgba(99,102,241,0.22), transparent 70%)', filter: 'blur(28px)', pointerEvents: 'none' }} />
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────
export default function LandingPageClient() {
  const [scrolled, setScrolled] = useState(false);
  const { ref: ctaRef, visible: ctaVisible } = useReveal();
  const { ref: featHeadRef, visible: featHeadVisible } = useReveal();
  const { ref: howHeadRef, visible: howHeadVisible } = useReveal();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');
        @keyframes lp-pulse { 0%,100%{opacity:.55} 50%{opacity:1} }
        @keyframes lp-lightning { 0%,92%,97%,100%{opacity:.38} 93%{opacity:1;filter:brightness(2)} 95%{opacity:.6} 96%{opacity:1;filter:brightness(1.7)} }
        @keyframes lp-float { 0%,100%{transform:translateY(0) rotate(0deg)} 33%{transform:translateY(-12px) rotate(1deg)} 66%{transform:translateY(-5px) rotate(-1deg)} }
        @keyframes lp-shimmer { 0%{background-position:-200% center} 100%{background-position:200% center} }
        @keyframes lp-beacon { 0%,100%{opacity:.14;transform:scale(1)} 50%{opacity:.3;transform:scale(1.07)} }
        @keyframes lp-in { from{opacity:0;transform:translateY(28px);filter:blur(6px)} to{opacity:1;transform:translateY(0);filter:blur(0)} }
        .lp-btn-p{transition:all .25s cubic-bezier(.4,0,.2,1)}
        .lp-btn-p:hover{opacity:.87;transform:translateY(-2px);box-shadow:0 14px 44px rgba(99,102,241,.62)!important}
        .lp-btn-g{transition:all .25s cubic-bezier(.4,0,.2,1)}
        .lp-btn-g:hover{background:rgba(255,255,255,.1)!important;transform:translateY(-2px)}
        .lp-nl:hover{color:#a5b4fc!important}
        .lp-nl{transition:color .2s}
        .lp-fl:hover{color:rgba(248,250,252,.55)!important}
        .lp-fl{transition:color .2s}
      `}</style>

      <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #090e1c 0%, #0f172a 28%, #19103d 62%, #0f172a 100%)', fontFamily: "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color: '#f8fafc', overflowX: 'hidden' }}>

        {/* ── NAVBAR ─────────────────────────────────────────────── */}
        <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 clamp(1.25rem,5vw,4rem)', height: 68, background: scrolled ? 'rgba(9,14,28,0.9)' : 'transparent', backdropFilter: scrolled ? 'blur(24px)' : 'none', borderBottom: scrolled ? '1px solid rgba(255,255,255,0.07)' : '1px solid transparent', transition: 'all .4s cubic-bezier(.4,0,.2,1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.15)', boxShadow: '0 0 18px rgba(99,102,241,0.3)', flexShrink: 0 }}>
              <img src="/icons/icon-192.png" alt="Buuga Xisaabta" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            <span style={{ fontWeight: 900, fontSize: '1.08rem', letterSpacing: '-0.022em' }}>Buuga <span style={{ color: '#818cf8' }}>Xisaabta</span></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.75rem' }}>
            <a href="#features" className="lp-nl" style={{ fontSize: '0.875rem', fontWeight: 600, color: 'rgba(248,250,252,0.5)', textDecoration: 'none' }}>Waxqabadka</a>
            <a href="#how" className="lp-nl" style={{ fontSize: '0.875rem', fontWeight: 600, color: 'rgba(248,250,252,0.5)', textDecoration: 'none' }}>Sida</a>
            <Link href="/login" className="lp-btn-p" style={{ padding: '0.5rem 1.35rem', borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', fontWeight: 700, fontSize: '0.875rem', textDecoration: 'none', boxShadow: '0 4px 18px rgba(99,102,241,0.38)', display: 'inline-block' }}>Gal →</Link>
          </div>
        </nav>

        {/* ── HERO ──────────────────────────────────────────────── */}
        <section style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: 'clamp(8.5rem,16vw,13rem) clamp(1.5rem,5vw,4rem) clamp(5rem,10vw,8rem)', overflow: 'hidden' }}>
          {/* Orbs */}
          <div style={{ position: 'absolute', top: '5%', left: '4%', width: 520, height: 520, borderRadius: '50%', background: 'radial-gradient(circle,rgba(99,102,241,0.2),transparent 70%)', filter: 'blur(70px)', pointerEvents: 'none', animation: 'lp-beacon 7s ease-in-out infinite' }} />
          <div style={{ position: 'absolute', bottom: '0%', right: '4%', width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle,rgba(139,92,246,0.17),transparent 70%)', filter: 'blur(60px)', pointerEvents: 'none', animation: 'lp-beacon 9s ease-in-out 2s infinite' }} />
          <div style={{ position: 'absolute', top: '45%', left: '50%', width: 700, height: 320, background: 'radial-gradient(ellipse,rgba(99,102,241,0.09),transparent 70%)', filter: 'blur(48px)', pointerEvents: 'none', transform: 'translate(-50%,-50%)' }} />
          {/* Lightning */}
          <LightningLayer opacity={0.28} />
          {/* Grid dots */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: 'radial-gradient(rgba(99,102,241,0.11) 1px,transparent 1px)', backgroundSize: '38px 38px', maskImage: 'radial-gradient(ellipse 82% 65% at 50% 50%,black,transparent)', WebkitMaskImage: 'radial-gradient(ellipse 82% 65% at 50% 50%,black,transparent)' }} />

          {/* Badge */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 1.1rem', borderRadius: 999, background: 'rgba(99,102,241,0.11)', border: '1px solid rgba(99,102,241,0.32)', fontSize: '0.77rem', fontWeight: 700, color: '#a5b4fc', marginBottom: '2rem', letterSpacing: '0.06em', animation: 'lp-in .7s cubic-bezier(.34,1.56,.64,1) both' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#818cf8', display: 'inline-block', boxShadow: '0 0 8px #818cf8', animation: 'lp-beacon 2s ease-in-out infinite' }} />
            Nidaamka Ganacsiga Casriga ah
          </div>

          {/* H1 */}
          <h1 style={{ fontSize: 'clamp(2.6rem,7.2vw,5.4rem)', fontWeight: 900, lineHeight: 1.04, letterSpacing: '-0.036em', maxWidth: 840, marginBottom: '1.6rem', animation: 'lp-in .8s cubic-bezier(.4,0,.2,1) .1s both' }}>
            Maaree Ganacsigaaga{' '}
            <span style={{ backgroundImage: 'linear-gradient(135deg,#818cf8 0%,#c084fc 50%,#818cf8 100%)', backgroundSize: '200% auto', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', animation: 'lp-shimmer 3.8s linear infinite' }}>Si Xirfadleh</span>
          </h1>

          {/* Sub */}
          <p style={{ fontSize: 'clamp(1rem,2.2vw,1.22rem)', color: 'rgba(248,250,252,0.56)', maxWidth: 620, lineHeight: 1.78, marginBottom: '2.8rem', animation: 'lp-in .8s cubic-bezier(.4,0,.2,1) .2s both' }}>
            Buuga Xisaabta waa nidaam casri ah oo aad ku maamusho xisaabaadka ganacsiga,
            maqalka, daymaha, iyo lacagaha — meel kasta, mar kasta.
          </p>

          {/* CTA buttons */}
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center', animation: 'lp-in .8s cubic-bezier(.4,0,.2,1) .3s both' }}>
            <Link href="/login" className="lp-btn-p" style={{ padding: '0.95rem 2.5rem', borderRadius: 14, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', fontWeight: 800, fontSize: '1rem', textDecoration: 'none', boxShadow: '0 8px 32px rgba(99,102,241,0.44)', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              Bilow Hadda
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </Link>
            <a href="#features" className="lp-btn-g" style={{ padding: '0.95rem 2.5rem', borderRadius: 14, background: 'rgba(255,255,255,0.056)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(248,250,252,0.8)', fontWeight: 700, fontSize: '1rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              Waxqabadka
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M4 9l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </a>
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 'clamp(1.5rem,5vw,4rem)', marginTop: 'clamp(3.5rem,7vw,6rem)', flexWrap: 'wrap', justifyContent: 'center', padding: '2rem 2.5rem', borderRadius: 20, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', backdropFilter: 'blur(10px)', animation: 'lp-in .8s cubic-bezier(.4,0,.2,1) .44s both' }}>
            {stats.map((s,i) => <StatBlock key={s.label} stat={s} delay={i*80} />)}
          </div>
        </section>

        {/* ── FEATURES ───────────────────────────────────────────── */}
        <section id="features" style={{ padding: 'clamp(5rem,10vw,8rem) clamp(1.5rem,5vw,4rem)', maxWidth: 1140, margin: '0 auto', position: 'relative' }}>
          <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 220, height: 1, background: 'linear-gradient(90deg,transparent,rgba(99,102,241,0.55),transparent)' }} />
          <div ref={featHeadRef} style={{ textAlign: 'center', marginBottom: 'clamp(3rem,6vw,5rem)', opacity: featHeadVisible ? 1 : 0, transform: featHeadVisible ? 'translateY(0)' : 'translateY(24px)', transition: 'all .6s cubic-bezier(.4,0,.2,1)' }}>
            <p style={{ color: '#818cf8', fontWeight: 700, fontSize: '0.76rem', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: '0.85rem' }}>Waxqabadka Nidaamka</p>
            <h2 style={{ fontSize: 'clamp(2rem,4.5vw,3.1rem)', fontWeight: 900, letterSpacing: '-0.026em', lineHeight: 1.14 }}>Wax kasta oo aad u baahantahay</h2>
            <p style={{ color: 'rgba(248,250,252,0.46)', marginTop: '0.85rem', fontSize: '1rem', maxWidth: 520, margin: '0.85rem auto 0', lineHeight: 1.72 }}>Nidaam buuxa oo ku habboon ganacsiyada yaryar iyo kuwa dhexdhexaadka ah.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,310px),1fr))', gap: '1.2rem' }}>
            {features.map((f,i) => <FeatureCard key={f.title} f={f} delay={i*65} />)}
          </div>
        </section>

        {/* ── HOW IT WORKS ───────────────────────────────────────── */}
        <section id="how" style={{ padding: 'clamp(5rem,10vw,8rem) clamp(1.5rem,5vw,4rem)', maxWidth: 1140, margin: '0 auto', position: 'relative' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,460px),1fr))', gap: 'clamp(3rem,6vw,5rem)', alignItems: 'center' }}>
            <div>
              <div ref={howHeadRef} style={{ opacity: howHeadVisible ? 1 : 0, transform: howHeadVisible ? 'translateY(0)' : 'translateY(20px)', transition: 'all .6s cubic-bezier(.4,0,.2,1)' }}>
                <p style={{ color: '#818cf8', fontWeight: 700, fontSize: '0.76rem', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: '0.85rem' }}>Sida Loogu Shaqeeyo</p>
                <h2 style={{ fontSize: 'clamp(1.9rem,4vw,2.75rem)', fontWeight: 900, letterSpacing: '-0.026em', lineHeight: 1.2, marginBottom: '2.5rem' }}>
                  Bilow si fudud,{' '}
                  <span style={{ color: '#818cf8' }}>maaree si xirfadleh</span>
                </h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
                {steps.map((s,i) => <StepCard key={s.num} step={s} delay={i*100} />)}
              </div>
            </div>
            <HowVisual />
          </div>
        </section>

        {/* ── CTA ──────────────────────────────────────────────── */}
        <section style={{ padding: '0 clamp(1.5rem,5vw,4rem) clamp(5rem,10vw,8rem)', maxWidth: 1140, margin: '0 auto' }}>
          <div ref={ctaRef} style={{ position: 'relative', borderRadius: 28, overflow: 'hidden', background: 'linear-gradient(135deg,rgba(99,102,241,0.18),rgba(139,92,246,0.13),rgba(99,102,241,0.09))', border: '1px solid rgba(99,102,241,0.28)', padding: 'clamp(2.5rem,5vw,4.5rem) clamp(2rem,5vw,4rem)', textAlign: 'center', backdropFilter: 'blur(20px)', opacity: ctaVisible ? 1 : 0, transform: ctaVisible ? 'translateY(0) scale(1)' : 'translateY(32px) scale(0.98)', transition: 'all .7s cubic-bezier(.4,0,.2,1)' }}>
            <LightningLayer opacity={0.18} />
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 420, height: 200, background: 'radial-gradient(ellipse,rgba(99,102,241,0.16),transparent 70%)', filter: 'blur(40px)', pointerEvents: 'none' }} />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 1rem', borderRadius: 999, background: 'rgba(99,102,241,0.14)', border: '1px solid rgba(99,102,241,0.32)', fontSize: '0.77rem', fontWeight: 700, color: '#a5b4fc', marginBottom: '1.5rem', letterSpacing: '0.06em' }}>
                🎯 Diyaar ma u tahay?
              </div>
              <h2 style={{ fontSize: 'clamp(1.8rem,4vw,2.8rem)', fontWeight: 900, letterSpacing: '-0.025em', lineHeight: 1.2, marginBottom: '1rem' }}>Ku biir ganacsiyada horumarsan</h2>
              <p style={{ color: 'rgba(248,250,252,0.52)', marginBottom: '2.25rem', fontSize: '1rem', maxWidth: 480, margin: '0 auto 2.25rem', lineHeight: 1.72 }}>
                Isticmaal Buuga Xisaabta maanta si aad xisaabaadkaaga ugu maamusho si fudud, degdeg, iyo ammaan ah.
              </p>
              <Link href="/login" className="lp-btn-p" style={{ padding: '1rem 2.75rem', borderRadius: 14, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', fontWeight: 800, fontSize: '1.05rem', textDecoration: 'none', boxShadow: '0 8px 32px rgba(99,102,241,0.5)', display: 'inline-block' }}>
                Gal Xisaabaadkaaga →
              </Link>
            </div>
          </div>
        </section>

        {/* ── FOOTER ──────────────────────────────────────────────── */}
        <footer style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: 'clamp(1.5rem,3vw,2.25rem) clamp(1.5rem,5vw,4rem)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', maxWidth: 1140, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <img src="/icons/icon-192.png" alt="" style={{ width: 24, height: 24, borderRadius: 7, objectFit: 'cover', opacity: 0.62 }} />
            <span style={{ color: 'rgba(248,250,252,0.32)', fontSize: '0.82rem', fontWeight: 600 }}>Buuga Xisaabta</span>
          </div>
          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <a href="#features" className="lp-fl" style={{ color: 'rgba(248,250,252,0.26)', fontSize: '0.8rem', textDecoration: 'none' }}>Waxqabadka</a>
            <a href="#how" className="lp-fl" style={{ color: 'rgba(248,250,252,0.26)', fontSize: '0.8rem', textDecoration: 'none' }}>Sida Loogu Shaqeeyo</a>
            <Link href="/login" className="lp-fl" style={{ color: 'rgba(248,250,252,0.26)', fontSize: '0.8rem', textDecoration: 'none' }}>Gal</Link>
          </div>
          <span style={{ color: 'rgba(248,250,252,0.22)', fontSize: '0.78rem' }}>© {new Date().getFullYear()} Buuga Xisaabta · buugaxisaabta.online</span>
        </footer>
      </div>
    </>
  );
}
