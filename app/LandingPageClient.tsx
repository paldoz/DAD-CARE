'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef, useState, useCallback } from 'react';

// Scroll-reveal hook
function useReveal(threshold: number = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) { setVisible(true); return; }
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

// Data
const features = [
  { icon: '📒', title: 'Buugga Maalinlaha', desc: 'Duubi dakhliga iyo kharashka maalin walba si taxaddar leh oo si fudud.', color: 'rgba(99,102,241,0.12)', border: 'rgba(99,102,241,0.3)', glow: '#6366f1' },
  { icon: '👥', title: 'Xisaabaadka Macaamiisha', desc: 'Raac daymaha macaamiisha, lacagaha la bixiyey, iyo taariikhda macaamil kasta.', color: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.3)', glow: '#8b5cf6' },
  { icon: '💳', title: 'Maqalka & Lacag Bixinta', desc: 'Maaree lacag bixinta iyo maqalka si sahlan oo aad u degdeg.', color: 'rgba(56,189,248,0.1)', border: 'rgba(56,189,248,0.28)', glow: '#38bdf8' },
  { icon: '📊', title: 'Warbixinnada Xisaabaadka', desc: 'Hel warbixinno dhamaystiran oo ku saabsan xaaladda maaliyadeed ee ganacsigaaga.', color: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.28)', glow: '#34d399' },
  { icon: '🔒', title: 'Ammaan & Kalsoonaan', desc: 'Maamul xogta ganacsigaaga adigoo adeegsanaya nidaamka amniga ee jira.', color: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.28)', glow: '#fbbf24' },
  { icon: '⚡', title: 'Degdeg & Fudud', desc: 'Nidaam ku shaqeeya telefoonka, kombiyuutarka, iyo tablet-ka.', color: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.28)', glow: '#ef4444' },
];

const trustItems = [
  { icon: '✅', label: '100% Aamin', sub: 'Xog Sugnaanta' },
  { icon: '🕐', label: '24/7 La Heli Karo', sub: 'Waqti Kasta' },
  { icon: '📈', label: 'Xisaab La Socod', sub: 'Dakhliga & Kharashka' },
  { icon: '⚡', label: 'Waxqabadka Nidaamka', sub: 'Degdeg & Xasilloon' },
];

interface ShowcaseItem {
  image: string;
  title: string;
  sub: string;
  desc: string;
  badge: string;
  align: string;
  accent: string;
}

const showcaseSections: ShowcaseItem[] = [
  { image: '/screenshots/customers.png', title: 'Xisaabaadka Macaamiisha', sub: 'Raac daymaha iyo lacagaha la bixiyey', desc: 'Arag macaamiishaada oo dhan hal meel — magacooda, lambarka, daymaha hadda, iyo taariikhda lacag bixinta. Nidaamku wuxuu ku siiyaa xog cad oo ku saabsan kiligaa macaamil.', badge: '👥 Customers', align: 'image-right', accent: '#6366f1' },
  { image: '/screenshots/reports.png', title: 'Warbixinnada Xisaabaadka', sub: 'Hel warbixinno buuxa markii aad u baahantahay', desc: 'Eeg wadarta daymaha guud, lacagaha la bixiyey, iyo xilliga waxqabadka macaamiisha. Advanced Reports-ku wuxuu ku siiyaa xog dhammaystiran oo ku saabsan ganacsigaaga.', badge: '📊 Reports', align: 'image-left', accent: '#34d399' },
  { image: '/screenshots/lacagaha.png', title: 'Lacagaha & Maqalka', sub: 'Raac dhammaan lacag bixinta hal meel', desc: 'Arag taariikhda lacag bixinta oo dhammaystiran — lacagta la bixiyey, taariikhda, iyo macaamil kasta oo la xiriira. 4,749 oo lacag bixin ayaa la daaweyn karo.', badge: '💳 Lacagaha', align: 'image-right', accent: '#38bdf8' },
  { image: '/screenshots/maqal.png', title: 'Buuga Maqalka', sub: 'Ku dhammaystir macaamiladaada si degdeg ah', desc: 'Nidaamka Maqalka wuxuu ku oggolaanayaa in aad si fudud uga doonto macaamiisha, xushid kuwa ku jira PRIORITY, oo aad ku buuxiso foom lacag bixin si aan waxba u dhibaatoonayn.', badge: '📒 Buuga Maqalka', align: 'image-left', accent: '#8b5cf6' },
  { image: '/screenshots/settings.png', title: 'Maamulka & Amniga', sub: 'Xog buuxda oo ku saabsan nidaamka', desc: 'SUPER_ADMIN wuxuu arki karaa cidda online ah, dhacdooyinka nidaamka dhammaantood, iyo qalabka maamulka sida User Management, Theme, iyo Audit Logs — wax walba hal meel.', badge: '🔒 Settings & Security', align: 'image-right', accent: '#fbbf24' },
];

// Feature Card component
function FeatureCard({ f, delay }: { f: typeof features[0]; delay: number }) {
  const { ref, visible } = useReveal();
  const [hovered, setHovered] = useState(false);
  return (
    <div ref={ref} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        padding: 'clamp(1.1rem,2.5vw,1.6rem)', borderRadius: 16,
        background: hovered ? f.color : 'rgba(255,255,255,0.03)',
        border: '1px solid ' + (hovered ? f.border : 'rgba(255,255,255,0.07)'),
        backdropFilter: 'blur(10px)',
        transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)',
        transform: visible ? (hovered ? 'translateY(-4px)' : 'translateY(0)') : 'translateY(22px)',
        opacity: visible ? 1 : 0, transitionDelay: delay + 'ms', cursor: 'default',
        boxShadow: hovered ? '0 14px 36px ' + f.color : 'none',
      }}>
      <div style={{ width: 44, height: 44, borderRadius: 11, background: f.color, border: '1px solid ' + f.border, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', marginBottom: '0.8rem' }}>{f.icon}</div>
      <h3 style={{ fontWeight: 800, fontSize: 'clamp(0.9rem,1.8vw,1rem)', marginBottom: '0.4rem', color: '#f1f5f9' }}>{f.title}</h3>
      <p style={{ color: 'rgba(248,250,252,0.46)', fontSize: 'clamp(0.8rem,1.6vw,0.88rem)', lineHeight: 1.65 }}>{f.desc}</p>
    </div>
  );
}

// Browser frame wrapper
function BrowserFrame({ src, alt, priority }: { src: string; alt: string; priority?: boolean }) {
  return (
    <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 24px 64px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.05)' }}>
      <div style={{ height: 32, background: 'rgba(15,23,42,0.98)', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', padding: '0 10px', gap: 5 }}>
        {['#ef4444','#f59e0b','#10b981'].map(c => <div key={c} style={{ width: 9, height: 9, borderRadius: '50%', background: c, opacity: 0.8 }} />)}
        <div style={{ flex: 1, marginLeft: 8, height: 18, borderRadius: 4, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', paddingLeft: 7 }}>
          <span style={{ fontSize: '0.58rem', color: 'rgba(255,255,255,0.28)' }}>buugaxisaabta.online</span>
        </div>
      </div>
      <Image src={src} alt={alt} width={960} height={580} priority={priority} loading={priority ? 'eager' : 'lazy'} style={{ width: '100%', height: 'auto', display: 'block', objectFit: 'cover' }} />
    </div>
  );
}

// Showcase section
function ShowcaseSection({ section, index }: { section: ShowcaseItem; index: number }) {
  const { ref, visible } = useReveal(0.08);
  const isImgLeft = section.align === 'image-left';
  return (
    <div ref={ref} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 'clamp(2rem,5vw,4rem)', alignItems: 'center', opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(28px)', transition: 'all 0.7s cubic-bezier(0.4,0,0.2,1)' }}>
      <div style={{ order: isImgLeft ? 2 : 1 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.28rem 0.85rem', borderRadius: 999, background: section.accent + '1f', border: '1px solid ' + section.accent + '3f', fontSize: '0.7rem', fontWeight: 700, color: section.accent, marginBottom: '0.85rem', letterSpacing: '0.06em' }}>{section.badge}</div>
        <h2 style={{ fontSize: 'clamp(1.5rem,3.5vw,2.3rem)', fontWeight: 900, letterSpacing: '-0.024em', lineHeight: 1.18, color: '#f8fafc', marginBottom: '0.5rem' }}>{section.title}</h2>
        <p style={{ fontSize: 'clamp(0.9rem,1.8vw,1rem)', fontWeight: 700, color: section.accent, marginBottom: '0.8rem' }}>{section.sub}</p>
        <p style={{ color: 'rgba(248,250,252,0.48)', fontSize: 'clamp(0.85rem,1.8vw,0.95rem)', lineHeight: 1.78, marginBottom: '1.5rem' }}>{section.desc}</p>
        <Link href="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.65rem 1.5rem', borderRadius: 10, background: 'linear-gradient(135deg,' + section.accent + ',' + section.accent + 'cc)', color: '#fff', fontWeight: 700, fontSize: '0.88rem', textDecoration: 'none', boxShadow: '0 4px 18px ' + section.accent + '3f', transition: 'all 0.22s' }}>Bilow Hadda →</Link>
      </div>
      <div style={{ order: isImgLeft ? 1 : 2, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: '-18px', background: 'radial-gradient(ellipse at center,' + section.accent + '16,transparent 70%)', borderRadius: 24, filter: 'blur(28px)', pointerEvents: 'none' }} />
        <BrowserFrame src={section.image} alt={section.title} priority={index === 0} />
        <div style={{ position: 'absolute', bottom: -12, right: 16, background: 'rgba(9,14,28,0.92)', border: '1px solid ' + section.accent + '3f', borderRadius: 10, padding: '0.45rem 0.9rem', backdropFilter: 'blur(16px)', display: 'flex', alignItems: 'center', gap: '0.4rem', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
          <span style={{ fontSize: '0.9rem' }}>{section.badge.split(' ')[0]}</span>
          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: section.accent }}>{section.title}</span>
        </div>
      </div>
    </div>
  );
}

// Main component
export default function LandingPageClient() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { ref: heroImgRef, visible: heroImgVisible } = useReveal(0.01);
  const { ref: heroTxtRef, visible: heroTxtVisible } = useReveal(0.01);
  const { ref: trustRef, visible: trustVisible } = useReveal(0.1);
  const { ref: featHeadRef, visible: featHeadVisible } = useReveal(0.1);
  const { ref: ctaRef, visible: ctaVisible } = useReveal(0.1);

  const handleScroll = useCallback(() => { setScrolled(window.scrollY > 20); }, []);
  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);
  useEffect(() => {
    const onResize = () => { if (window.innerWidth >= 768) setMobileMenuOpen(false); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const navLinks = [{ label: 'Guriga', href: '#top' }, { label: 'Waxqabadka', href: '#features' }, { label: 'Sida', href: '#showcase' }, { label: 'Ku Saabsan', href: '#cta' }];
  const dots = ['#ef4444','#f59e0b','#10b981'];

  return (
    <>
      <style>{"\n        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');\n        @keyframes lp-in { from{opacity:0;transform:translateY(20px);filter:blur(3px)} to{opacity:1;transform:translateY(0);filter:blur(0)} }\n        @keyframes lp-pulse { 0%,100%{opacity:.4} 50%{opacity:.85} }\n        @keyframes lp-beacon { 0%,100%{opacity:.1;transform:scale(1)} 50%{opacity:.22;transform:scale(1.06)} }\n        @keyframes lp-float { 0%,100%{transform:translateY(0) rotate(-1deg)} 50%{transform:translateY(-9px) rotate(1deg)} }\n        @keyframes lp-shimmer { 0%{background-position:-200% center} 100%{background-position:200% center} }\n        .lp-btn-p{transition:all .22s cubic-bezier(.4,0,.2,1)}\n        .lp-btn-p:hover{opacity:.88;transform:translateY(-2px);box-shadow:0 14px 40px rgba(99,102,241,.5)!important}\n        .lp-btn-g{transition:all .22s cubic-bezier(.4,0,.2,1)}\n        .lp-btn-g:hover{background:rgba(255,255,255,.1)!important;transform:translateY(-1px)}\n        .lp-nl{transition:color .18s}\n        .lp-nl:hover{color:#a5b4fc!important}\n        .lp-fl{transition:color .18s}\n        .lp-fl:hover{color:rgba(248,250,252,.6)!important}\n        .lp-mm{animation:lp-in .2s cubic-bezier(.4,0,.2,1) both}\n        @media(min-width:768px){.lp-dnav{display:flex!important}.lp-ham{display:none!important}}\n        @media(max-width:767px){.lp-dnav{display:none!important}.lp-ham{display:flex!important}}\n        @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;transition-duration:.001ms!important}}\n      "}</style>

      <div id="top" style={{ minHeight:'100vh', background:'linear-gradient(160deg,#090e1c 0%,#0f172a 30%,#18103a 62%,#0f172a 100%)', fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color:'#f8fafc', overflowX:'hidden', maxWidth:'100vw' }}>

        {/* NAVBAR */}
        <nav style={{ position:'fixed', top:0, left:0, right:0, zIndex:200, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 clamp(1rem,5vw,3.5rem)', height:62, background:scrolled?'rgba(9,14,28,0.93)':'transparent', backdropFilter:scrolled?'blur(20px)':'none', borderBottom:scrolled?'1px solid rgba(255,255,255,0.07)':'1px solid transparent', transition:'all .32s cubic-bezier(.4,0,.2,1)' }}>
          <a href="#top" style={{ display:'flex', alignItems:'center', gap:'0.55rem', textDecoration:'none' }}>
            <div style={{ width:34, height:34, borderRadius:8, overflow:'hidden', border:'1px solid rgba(255,255,255,0.15)', boxShadow:'0 0 12px rgba(99,102,241,0.3)', flexShrink:0 }}><img src="/icons/icon-192.png" alt="Buuga Xisaabta" style={{ width:'100%', height:'100%', objectFit:'cover' }} /></div>
            <span style={{ fontWeight:900, fontSize:'1rem', letterSpacing:'-0.02em', color:'#f8fafc' }}>Buuga <span style={{ color:'#818cf8' }}>Xisaabta</span></span>
          </a>
          <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
            <div className="lp-dnav" style={{ alignItems:'center', gap:'1.4rem' }}>
              {navLinks.map(l => <a key={l.label} href={l.href} className="lp-nl" style={{ fontSize:'0.855rem', fontWeight:600, color:'rgba(248,250,252,0.5)', textDecoration:'none' }}>{l.label}</a>)}
            </div>
            <Link href="/login" id="nav-login-btn" className="lp-btn-p" style={{ padding:'0.44rem 1.15rem', borderRadius:8, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', fontWeight:700, fontSize:'0.855rem', textDecoration:'none', boxShadow:'0 4px 14px rgba(99,102,241,0.35)', display:'inline-block' }}>Gal</Link>
            <button className="lp-ham" onClick={() => setMobileMenuOpen(v=>!v)} aria-label="Toggle navigation" style={{ display:'flex', flexDirection:'column', justifyContent:'center', gap:4, padding:'0.45rem', borderRadius:7, border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.05)', cursor:'pointer', flexShrink:0 }}>
              {[0,1,2].map(i => <span key={i} style={{ display:'block', width:18, height:2, background:'#f8fafc', borderRadius:2, transition:'all .2s', transform:mobileMenuOpen?(i===0?'rotate(45deg) translate(4px,4px)':i===1?'scaleX(0)':'rotate(-45deg) translate(4px,-4px)'):'none', opacity:mobileMenuOpen&&i===1?0:1 }} />)}
            </button>
          </div>
        </nav>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="lp-mm" style={{ position:'fixed', top:62, left:0, right:0, zIndex:190, background:'rgba(9,14,28,0.97)', borderBottom:'1px solid rgba(255,255,255,0.07)', backdropFilter:'blur(20px)', padding:'0.75rem clamp(1rem,5vw,2rem) 1.25rem' }}>
            {navLinks.map(l => <a key={l.label} href={l.href} onClick={() => setMobileMenuOpen(false)} style={{ display:'block', padding:'0.7rem 0', fontSize:'0.95rem', fontWeight:600, color:'rgba(248,250,252,0.7)', textDecoration:'none', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>{l.label}</a>)}
            <Link href="/login" onClick={() => setMobileMenuOpen(false)} style={{ display:'block', marginTop:'0.9rem', padding:'0.75rem', borderRadius:10, textAlign:'center', background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', fontWeight:700, fontSize:'0.95rem', textDecoration:'none' }}>Gal Xisaabaadkaaga →</Link>
          </div>
        )}

        {/* HERO */}
        <section style={{ position:'relative', padding:'clamp(7rem,13vw,10rem) clamp(1rem,5vw,3.5rem) clamp(3.5rem,7vw,5.5rem)', maxWidth:1200, margin:'0 auto', overflow:'hidden' }}>
          <div style={{ position:'absolute', top:'8%', left:'2%', width:'clamp(240px,38vw,460px)', height:'clamp(240px,38vw,460px)', borderRadius:'50%', background:'radial-gradient(circle,rgba(99,102,241,0.17),transparent 70%)', filter:'blur(56px)', pointerEvents:'none', animation:'lp-beacon 7s ease-in-out infinite' }} />
          <div style={{ position:'absolute', bottom:'5%', right:'3%', width:'clamp(190px,28vw,360px)', height:'clamp(190px,28vw,360px)', borderRadius:'50%', background:'radial-gradient(circle,rgba(139,92,246,0.13),transparent 70%)', filter:'blur(48px)', pointerEvents:'none', animation:'lp-beacon 9s ease-in-out 2s infinite' }} />
          <div style={{ position:'absolute', inset:0, overflow:'hidden', pointerEvents:'none', opacity:0.28 }}>
            <div style={{ position:'absolute', top:'-15%', left:'20%', width:2, height:'140%', background:'linear-gradient(to bottom,transparent,#818cf8 45%,transparent)', transform:'rotate(18deg)', filter:'blur(1px)', animation:'lp-pulse 4s ease-in-out infinite' }} />
            <div style={{ position:'absolute', top:'25%', left:'62%', width:1, height:'80%', background:'linear-gradient(to bottom,transparent,#93c5fd 45%,transparent)', transform:'rotate(38deg)', filter:'blur(1px)', animation:'lp-pulse 5.5s ease-in-out 1s infinite' }} />
          </div>
          <div style={{ position:'absolute', inset:0, pointerEvents:'none', backgroundImage:'radial-gradient(rgba(99,102,241,0.09) 1px,transparent 1px)', backgroundSize:'36px 36px', maskImage:'radial-gradient(ellipse 80% 60% at 50% 50%,black,transparent)', WebkitMaskImage:'radial-gradient(ellipse 80% 60% at 50% 50%,black,transparent)' }} />

          <div style={{ position:'relative', zIndex:1, display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,390px),1fr))', gap:'clamp(2.5rem,5vw,5rem)', alignItems:'center' }}>
            {/* Hero text */}
            <div ref={heroTxtRef} style={{ textAlign:'center', opacity:heroTxtVisible?1:0, transform:heroTxtVisible?'translateY(0)':'translateY(20px)', transition:'all .7s cubic-bezier(.4,0,.2,1)' }}>
              <div style={{ display:'inline-flex', alignItems:'center', gap:'0.4rem', padding:'0.32rem 0.95rem', borderRadius:999, background:'rgba(99,102,241,0.12)', border:'1px solid rgba(99,102,241,0.3)', fontSize:'0.74rem', fontWeight:700, color:'#a5b4fc', marginBottom:'1.4rem', letterSpacing:'0.06em' }}>
                <span style={{ width:7, height:7, borderRadius:'50%', background:'#818cf8', display:'inline-block', boxShadow:'0 0 8px #818cf8', animation:'lp-beacon 2s ease-in-out infinite' }} />
                🚀 Nidaamka Ganacsiga Casriga ah
              </div>
              <h1 style={{ fontSize:'clamp(2rem,6vw,4.4rem)', fontWeight:900, lineHeight:1.07, letterSpacing:'-0.034em', marginBottom:'1.15rem' }}>
                Maaree Ganacsigaaga{' '}
                <span style={{ backgroundImage:'linear-gradient(135deg,#818cf8 0%,#c084fc 50%,#818cf8 100%)', backgroundSize:'200% auto', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', animation:'lp-shimmer 4s linear infinite' }}>Si Xirfadleh</span>
              </h1>
              <p style={{ fontSize:'clamp(0.92rem,1.9vw,1.12rem)', color:'rgba(248,250,252,0.54)', lineHeight:1.78, maxWidth:540, margin:'0 auto 1.9rem' }}>
                Buuga Xisaabta waa nidaam casri ah oo aad ku maamuli karto xisaabaadka ganacsiga, maqalka, daymaha, iyo lacagaha — meel kasta, mar kasta.
              </p>
              <div style={{ display:'flex', gap:'0.8rem', justifyContent:'center', flexWrap:'wrap' }}>
                <Link href="/login" id="hero-cta-primary" className="lp-btn-p" style={{ padding:'clamp(0.65rem,2vw,0.85rem) clamp(1.4rem,3.5vw,2.1rem)', borderRadius:11, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', fontWeight:800, fontSize:'clamp(0.88rem,1.8vw,0.98rem)', textDecoration:'none', boxShadow:'0 6px 26px rgba(99,102,241,0.42)', display:'inline-flex', alignItems:'center', gap:'0.4rem' }}>Bilow Hadda →</Link>
                <a href="#features" className="lp-btn-g" style={{ padding:'clamp(0.65rem,2vw,0.85rem) clamp(1.4rem,3.5vw,2.1rem)', borderRadius:11, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.11)', color:'rgba(248,250,252,0.72)', fontWeight:700, fontSize:'clamp(0.88rem,1.8vw,0.98rem)', textDecoration:'none', display:'inline-flex', alignItems:'center', gap:'0.4rem' }}>Waxqabadka ↓</a>
              </div>
            </div>

            {/* Hero screenshot */}
            <div ref={heroImgRef} style={{ position:'relative', opacity:heroImgVisible?1:0, transform:heroImgVisible?'translateY(0) scale(1)':'translateY(22px) scale(0.97)', transition:'all 0.8s cubic-bezier(0.4,0,0.2,1) 0.22s' }}>
              <div style={{ position:'absolute', inset:-22, background:'radial-gradient(ellipse at center,rgba(99,102,241,0.18),transparent 70%)', borderRadius:26, filter:'blur(26px)', pointerEvents:'none' }} />
              <div style={{ borderRadius:13, overflow:'hidden', border:'1px solid rgba(255,255,255,0.13)', boxShadow:'0 28px 80px rgba(0,0,0,0.58), 0 0 0 1px rgba(255,255,255,0.05)', animation:'lp-float 8s ease-in-out 1s infinite' }}>
                <div style={{ height:30, background:'rgba(15,23,42,0.98)', borderBottom:'1px solid rgba(255,255,255,0.07)', display:'flex', alignItems:'center', padding:'0 10px', gap:5 }}>
                  {dots.map(c => <div key={c} style={{ width:9, height:9, borderRadius:'50%', background:c, opacity:0.8 }} />)}
                  <div style={{ flex:1, marginLeft:8, height:17, borderRadius:4, background:'rgba(255,255,255,0.06)', display:'flex', alignItems:'center', paddingLeft:7 }}><span style={{ fontSize:'0.57rem', color:'rgba(255,255,255,0.28)' }}>buugaxisaabta.online/customers</span></div>
                </div>
                <Image src="/screenshots/customers.png" alt="Buuga Xisaabta — Customers list with 20 active customers and balances" width={900} height={540} priority style={{ width:'100%', height:'auto', display:'block' }} />
              </div>
              <div style={{ position:'absolute', bottom:-14, left:18, background:'rgba(9,14,28,0.93)', border:'1px solid rgba(99,102,241,0.35)', borderRadius:11, padding:'0.48rem 0.95rem', backdropFilter:'blur(16px)', display:'flex', alignItems:'center', gap:'0.48rem', boxShadow:'0 8px 24px rgba(0,0,0,0.42)' }}>
                <span style={{ fontSize:'1rem' }}>👥</span>
                <div><div style={{ fontSize:'0.68rem', fontWeight:800, color:'#818cf8' }}>ACTIVE: 20</div><div style={{ fontSize:'0.58rem', color:'rgba(248,250,252,0.38)', fontWeight:600 }}>Macaamiisha</div></div>
              </div>
            </div>
          </div>
        </section>

        {/* TRUST INDICATORS */}
        <section style={{ padding:'0 clamp(1rem,5vw,3.5rem) clamp(2rem,4vw,3.5rem)', maxWidth:1200, margin:'0 auto' }}>
          <div ref={trustRef} style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,190px),1fr))', gap:'0.85rem', padding:'clamp(1.1rem,2.5vw,1.6rem) clamp(1.25rem,3.5vw,2.25rem)', borderRadius:16, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', backdropFilter:'blur(12px)', opacity:trustVisible?1:0, transform:trustVisible?'translateY(0)':'translateY(18px)', transition:'all .62s cubic-bezier(.4,0,.2,1)' }}>
            {trustItems.map((item,i) => (
              <div key={item.label} style={{ display:'flex', alignItems:'center', gap:'0.65rem', padding:'0.4rem', opacity:trustVisible?1:0, transition:'opacity .5s ease ' + (i*100+200) + 'ms' }}>
                <div style={{ width:38, height:38, borderRadius:9, flexShrink:0, background:'rgba(99,102,241,0.11)', border:'1px solid rgba(99,102,241,0.22)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.1rem' }}>{item.icon}</div>
                <div><div style={{ fontWeight:800, fontSize:'0.86rem', color:'#f1f5f9' }}>{item.label}</div><div style={{ fontSize:'0.7rem', color:'rgba(248,250,252,0.36)', fontWeight:600 }}>{item.sub}</div></div>
              </div>
            ))}
          </div>
        </section>

        {/* FEATURES */}
        <section id="features" style={{ padding:'clamp(3.5rem,7vw,6.5rem) clamp(1rem,5vw,3.5rem)', maxWidth:1200, margin:'0 auto', position:'relative' }}>
          <div style={{ position:'absolute', top:0, left:'50%', transform:'translateX(-50%)', width:180, height:1, background:'linear-gradient(90deg,transparent,rgba(99,102,241,0.5),transparent)' }} />
          <div ref={featHeadRef} style={{ textAlign:'center', marginBottom:'clamp(2.2rem,4.5vw,4rem)', opacity:featHeadVisible?1:0, transform:featHeadVisible?'translateY(0)':'translateY(18px)', transition:'all .6s cubic-bezier(.4,0,.2,1)' }}>
            <p style={{ color:'#818cf8', fontWeight:700, fontSize:'0.72rem', letterSpacing:'0.16em', textTransform:'uppercase', marginBottom:'0.65rem' }}>Waxqabadka Nidaamka</p>
            <h2 style={{ fontSize:'clamp(1.7rem,4vw,2.9rem)', fontWeight:900, letterSpacing:'-0.024em', lineHeight:1.15 }}>Wax kasta oo aad u baahantahay</h2>
            <p style={{ color:'rgba(248,250,252,0.44)', marginTop:'0.7rem', fontSize:'clamp(0.88rem,1.8vw,0.98rem)', maxWidth:500, margin:'0.7rem auto 0', lineHeight:1.72 }}>Nidaam buuxa oo ku habboon ganacsiyada yaryar iyo kuwa dhexdhexaadka ah.</p>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,270px),1fr))', gap:'clamp(0.7rem,1.8vw,1rem)' }}>
            {features.map((f,i) => <FeatureCard key={f.title} f={f} delay={i*55} />)}
          </div>
        </section>

        {/* SHOWCASE */}
        <section id="showcase" style={{ padding:'clamp(0.5rem,2vw,1.5rem) clamp(1rem,5vw,3.5rem)', maxWidth:1200, margin:'0 auto' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:'clamp(4rem,8vw,7rem)' }}>
            {showcaseSections.map((s,i) => <ShowcaseSection key={s.title} section={s} index={i} />)}
          </div>
        </section>

        {/* CTA */}
        <section id="cta" style={{ padding:'clamp(4rem,7.5vw,6.5rem) clamp(1rem,5vw,3.5rem)', maxWidth:1200, margin:'0 auto' }}>
          <div ref={ctaRef} style={{ position:'relative', borderRadius:22, overflow:'hidden', background:'linear-gradient(135deg,rgba(99,102,241,0.15),rgba(139,92,246,0.1),rgba(99,102,241,0.07))', border:'1px solid rgba(99,102,241,0.24)', padding:'clamp(2.5rem,5.5vw,4.5rem) clamp(1.5rem,5vw,4rem)', textAlign:'center', backdropFilter:'blur(20px)', opacity:ctaVisible?1:0, transform:ctaVisible?'translateY(0) scale(1)':'translateY(26px) scale(0.98)', transition:'all .68s cubic-bezier(.4,0,.2,1)' }}>
            <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', width:380, height:170, background:'radial-gradient(ellipse,rgba(99,102,241,0.13),transparent 70%)', filter:'blur(36px)', pointerEvents:'none' }} />
            <div style={{ position:'relative', zIndex:1 }}>
              <div style={{ display:'inline-flex', alignItems:'center', gap:'0.4rem', padding:'0.28rem 0.85rem', borderRadius:999, background:'rgba(99,102,241,0.13)', border:'1px solid rgba(99,102,241,0.28)', fontSize:'0.72rem', fontWeight:700, color:'#a5b4fc', marginBottom:'1.2rem', letterSpacing:'0.06em' }}>🎯 Diyaar ma u tahay?</div>
              <h2 style={{ fontSize:'clamp(1.65rem,4vw,2.7rem)', fontWeight:900, letterSpacing:'-0.023em', lineHeight:1.18, marginBottom:'0.85rem' }}>Ku biir ganacsiyada horumarsan</h2>
              <p style={{ color:'rgba(248,250,252,0.48)', marginBottom:'1.9rem', fontSize:'clamp(0.88rem,1.8vw,0.98rem)', maxWidth:460, margin:'0 auto 1.9rem', lineHeight:1.74 }}>Ku bilow ganacsigaaga isticmaalaya Buuga Xisaabta si ay xisaabaadkaagu ugu maamulaan.</p>
              <Link href="/login" id="cta-final-btn" className="lp-btn-p" style={{ padding:'clamp(0.75rem,2vw,0.95rem) clamp(1.85rem,4vw,2.6rem)', borderRadius:12, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', fontWeight:800, fontSize:'clamp(0.92rem,1.9vw,1.02rem)', textDecoration:'none', boxShadow:'0 8px 30px rgba(99,102,241,0.48)', display:'inline-block' }}>Gal Xisaabaadkaaga →</Link>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer style={{ borderTop:'1px solid rgba(255,255,255,0.07)', padding:'clamp(1.5rem,3vw,2.25rem) clamp(1rem,5vw,3.5rem)', maxWidth:1200, margin:'0 auto' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,190px),1fr))', gap:'clamp(1.25rem,2.5vw,2rem)', alignItems:'start' }}>
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.65rem' }}>
                <img src="/icons/icon-192.png" alt="" style={{ width:24, height:24, borderRadius:6, objectFit:'cover', opacity:0.68 }} />
                <span style={{ fontWeight:900, fontSize:'0.9rem', color:'rgba(248,250,252,0.68)' }}>Buuga Xisaabta</span>
              </div>
              <p style={{ fontSize:'0.78rem', color:'rgba(248,250,252,0.28)', lineHeight:1.65, maxWidth:210 }}>Nidaam casri ah oo lagu maamulo xisaabaadka ganacsiga.</p>
            </div>
            <div>
              <p style={{ fontSize:'0.68rem', fontWeight:800, color:'rgba(248,250,252,0.32)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:'0.7rem' }}>Bogga</p>
              {[{ label:'Guriga', href:'#top' },{ label:'Waxqabadka', href:'#features' },{ label:'Sida Loogu Shaqeeyo', href:'#showcase' },{ label:'Gal', href:'/login' }].map(l => <a key={l.label} href={l.href} className="lp-fl" style={{ display:'block', marginBottom:'0.4rem', fontSize:'0.8rem', color:'rgba(248,250,252,0.26)', textDecoration:'none', fontWeight:600 }}>{l.label}</a>)}
            </div>
            <div>
              <p style={{ fontSize:'0.68rem', fontWeight:800, color:'rgba(248,250,252,0.32)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:'0.7rem' }}>Bilow</p>
              <p style={{ fontSize:'0.8rem', color:'rgba(248,250,252,0.28)', lineHeight:1.65, marginBottom:'0.8rem' }}>Haysataa akoon? Gal oo bilow.</p>
              <Link href="/login" style={{ display:'inline-flex', alignItems:'center', gap:'0.3rem', padding:'0.45rem 1rem', borderRadius:7, background:'rgba(99,102,241,0.13)', border:'1px solid rgba(99,102,241,0.26)', color:'#818cf8', fontWeight:700, fontSize:'0.8rem', textDecoration:'none', transition:'all .2s' }}>Gal →</Link>
            </div>
          </div>
          <div style={{ marginTop:'clamp(1.25rem,2.5vw,2rem)', paddingTop:'clamp(0.85rem,1.8vw,1.35rem)', borderTop:'1px solid rgba(255,255,255,0.06)', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'0.5rem' }}>
            <span style={{ fontSize:'0.73rem', color:'rgba(248,250,252,0.18)' }}>© {new Date().getFullYear()} Buuga Xisaabta · buugaxisaabta.online</span>
            <span style={{ fontSize:'0.68rem', color:'rgba(248,250,252,0.12)' }}>Precision Ledger System</span>
          </div>
        </footer>

      </div>
    </>
  );
}