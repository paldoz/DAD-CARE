import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Buuga Xisaabta - Nidaamka Maamulka Ganacsiga & Maqalka',
  description:
    'Buuga Xisaabta waa nidaam casri ah oo lagu maamulo xisaabaadka ganacsiga, maqalka, daymaha, iyo lacagaha. Hel warbixinta xisaabta maalinlaha ah si fudud.',
  alternates: { canonical: 'https://www.buugaxisaabta.online' },
};

const features = [
  {
    icon: '📒',
    title: 'Buugga Maalinlaha',
    desc: 'Duubi dakhliga iyo kharashka maalin walba si taxaddar leh oo si fudud.',
  },
  {
    icon: '👥',
    title: 'Xisaabaadka Macaamiisha',
    desc: 'Raac daymaha macaamiisha, lacagaha la bixiyey, iyo taariikhda macaamiil kasta.',
  },
  {
    icon: '💳',
    title: 'Maqalka & Lacag Bixinta',
    desc: 'Maaree lacag bixinta iyo maqalka si sahlan oo aad u deggan.',
  },
  {
    icon: '📊',
    title: 'Warbixinnada Xisaabaadka',
    desc: 'Hel warbixinno dhammaystiran oo ku saabsan xaalada maaliyadeed ganacsigaaga.',
  },
  {
    icon: '🔒',
    title: 'Ammaan & Kalsoonaan',
    desc: 'Xogta ganacsigaaga waxay ku amaan tahay nidaam sireed oo casri ah.',
  },
  {
    icon: '⚡',
    title: 'Degdeg & Faa\'iido',
    desc: 'Nidaam degdeg ah oo shaqeeyaa telefoonka, kombiyuutarka, iyo tablet-ka.',
  },
];

const stats = [
  { value: '100%', label: 'Aamin' },
  { value: '24/7', label: 'La Heli Karo' },
  { value: '0', label: 'Khasaare Xog' },
];

export default function LandingPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 40%, #0f172a 100%)',
        fontFamily: "'Inter', sans-serif",
        color: '#f8fafc',
        overflowX: 'hidden',
      }}
    >
      {/* ── NAVBAR ── */}
      <nav
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 clamp(1.5rem, 5vw, 4rem)',
          height: '68px',
          background: 'rgba(15,23,42,0.85)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img
            src="/icons/icon-192.png"
            alt="Buuga Xisaabta"
            style={{ width: 36, height: 36, borderRadius: 10, objectFit: 'cover' }}
          />
          <span style={{ fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>
            Buuga <span style={{ color: '#818cf8' }}>Xisaabta</span>
          </span>
        </div>
        <Link
          href="/login"
          style={{
            padding: '0.55rem 1.4rem',
            borderRadius: 10,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: '#fff',
            fontWeight: 700,
            fontSize: '0.875rem',
            textDecoration: 'none',
            boxShadow: '0 4px 20px rgba(99,102,241,0.4)',
            transition: 'opacity 0.2s',
          }}
        >
          Gal
        </Link>
      </nav>

      {/* ── HERO ── */}
      <section
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          padding: 'clamp(5rem, 12vw, 9rem) clamp(1.5rem, 5vw, 4rem) clamp(4rem, 8vw, 7rem)',
          overflow: 'hidden',
        }}
      >
        {/* Glow orbs */}
        <div style={{
          position: 'absolute', top: '10%', left: '10%',
          width: 400, height: 400, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99,102,241,0.25), transparent 70%)',
          filter: 'blur(60px)', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: '5%', right: '10%',
          width: 300, height: 300, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(139,92,246,0.2), transparent 70%)',
          filter: 'blur(50px)', pointerEvents: 'none',
        }} />

        {/* Badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
          padding: '0.35rem 1rem', borderRadius: 999,
          background: 'rgba(99,102,241,0.15)',
          border: '1px solid rgba(99,102,241,0.3)',
          fontSize: '0.78rem', fontWeight: 600, color: '#a5b4fc',
          marginBottom: '1.75rem', letterSpacing: '0.05em',
        }}>
          🚀 Nidaamka Ganacsiga Casriga ah
        </div>

        <h1 style={{
          fontSize: 'clamp(2.4rem, 6vw, 4.5rem)',
          fontWeight: 900,
          lineHeight: 1.1,
          letterSpacing: '-0.03em',
          maxWidth: '780px',
          marginBottom: '1.5rem',
        }}>
          Maaree Ganacsigaaga{' '}
          <span style={{
            background: 'linear-gradient(135deg, #818cf8, #c084fc)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
            Si Xirfadleh
          </span>
        </h1>

        <p style={{
          fontSize: 'clamp(1rem, 2vw, 1.2rem)',
          color: 'rgba(248,250,252,0.6)',
          maxWidth: '600px',
          lineHeight: 1.7,
          marginBottom: '2.5rem',
        }}>
          Buuga Xisaabta waa nidaam casri ah oo aad ku maamusho xisaabaadka ganacsiga,
          maqalka, daymaha, iyo lacagaha — meel kasta, mar kasta.
        </p>

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link
            href="/login"
            style={{
              padding: '0.9rem 2.2rem',
              borderRadius: 14,
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: '#fff',
              fontWeight: 800,
              fontSize: '1rem',
              textDecoration: 'none',
              boxShadow: '0 8px 30px rgba(99,102,241,0.45)',
              display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            }}
          >
            Bilow Hadda →
          </Link>
          <a
            href="#features"
            style={{
              padding: '0.9rem 2.2rem',
              borderRadius: 14,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'rgba(248,250,252,0.8)',
              fontWeight: 700,
              fontSize: '1rem',
              textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            }}
          >
            Waxqabadka ↓
          </a>
        </div>

        {/* Stats */}
        <div style={{
          display: 'flex', gap: 'clamp(2rem, 5vw, 4rem)',
          marginTop: 'clamp(3rem, 6vw, 5rem)',
          flexWrap: 'wrap', justifyContent: 'center',
        }}>
          {stats.map((s) => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: 'clamp(1.8rem, 4vw, 2.8rem)',
                fontWeight: 900,
                background: 'linear-gradient(135deg, #818cf8, #c084fc)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                lineHeight: 1,
              }}>{s.value}</div>
              <div style={{ fontSize: '0.8rem', color: 'rgba(248,250,252,0.45)', marginTop: '0.3rem', fontWeight: 600 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section
        id="features"
        style={{
          padding: 'clamp(4rem, 8vw, 7rem) clamp(1.5rem, 5vw, 4rem)',
          maxWidth: 1100,
          margin: '0 auto',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 'clamp(2.5rem, 5vw, 4rem)' }}>
          <p style={{ color: '#818cf8', fontWeight: 700, fontSize: '0.85rem', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
            Waxqabadka Nidaamka
          </p>
          <h2 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            Wax kasta oo aad u baahantahay
          </h2>
          <p style={{ color: 'rgba(248,250,252,0.5)', marginTop: '0.75rem', fontSize: '1rem', maxWidth: 500, margin: '0.75rem auto 0' }}>
            Nidaam buuxa oo ku habboon ganacsiyada yaryar iyo kuwa dhexdhexaadka ah.
          </p>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
          gap: '1.25rem',
        }}>
          {features.map((f) => (
            <div
              key={f.title}
              style={{
                padding: '1.75rem',
                borderRadius: 18,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                backdropFilter: 'blur(10px)',
                transition: 'border-color 0.3s, transform 0.3s',
              }}
            >
              <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>{f.icon}</div>
              <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: '0.5rem' }}>{f.title}</h3>
              <p style={{ color: 'rgba(248,250,252,0.5)', fontSize: '0.9rem', lineHeight: 1.65 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section style={{
        margin: '0 clamp(1.5rem, 5vw, 4rem) clamp(4rem, 8vw, 7rem)',
        borderRadius: 24,
        background: 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.2))',
        border: '1px solid rgba(99,102,241,0.3)',
        padding: 'clamp(2.5rem, 5vw, 4rem)',
        textAlign: 'center',
        backdropFilter: 'blur(20px)',
        maxWidth: 1100,
        marginLeft: 'auto',
        marginRight: 'auto',
      }}>
        <h2 style={{ fontSize: 'clamp(1.6rem, 3.5vw, 2.4rem)', fontWeight: 900, letterSpacing: '-0.02em', marginBottom: '1rem' }}>
          Diyaar ma u tahay?
        </h2>
        <p style={{ color: 'rgba(248,250,252,0.6)', marginBottom: '2rem', fontSize: '1rem', maxWidth: 480, margin: '0 auto 2rem' }}>
          Ku biir ganacsiyada isticmaalaya Buuga Xisaabta si ay xisaabaadkooda ugu maamulaan.
        </p>
        <Link
          href="/login"
          style={{
            padding: '0.9rem 2.5rem',
            borderRadius: 14,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: '#fff',
            fontWeight: 800,
            fontSize: '1rem',
            textDecoration: 'none',
            boxShadow: '0 8px 30px rgba(99,102,241,0.5)',
            display: 'inline-block',
          }}
        >
          Gal Xisaabaadkaaga →
        </Link>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{
        borderTop: '1px solid rgba(255,255,255,0.07)',
        padding: 'clamp(1.5rem, 3vw, 2rem) clamp(1.5rem, 5vw, 4rem)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '1rem',
        color: 'rgba(248,250,252,0.3)',
        fontSize: '0.8rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <img src="/icons/icon-192.png" alt="" style={{ width: 22, height: 22, borderRadius: 6, objectFit: 'cover', opacity: 0.6 }} />
          <span>Buuga Xisaabta</span>
        </div>
        <span>© {new Date().getFullYear()} Buuga Xisaabta · buugaxisaabta.online</span>
      </footer>
    </div>
  );
}
