'use client';

/**
 * AnimatedBackground — the same energy-beam / thunder lines from the login page.
 * Drop this inside any container with `relative overflow-hidden`.
 * It sits at z-0 so all content above it must use relative z-10 or higher.
 */
export function AnimatedBackground() {
    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none select-none" aria-hidden>
            {/* ── Dark-mode beams (visible in dark, hidden in light) ── */}
            <div className="hidden dark:block absolute inset-0">
                {/* Beam 1 — indigo */}
                <div className="absolute top-[-10%] right-[20%] w-[2px] h-[130%] bg-indigo-300 -rotate-[15deg] blur-[1px] animate-[pulse_4s_ease-in-out_infinite]" />
                <div className="absolute top-[-10%] right-[20%] w-[40px] h-[130%] bg-indigo-500/10 -rotate-[15deg] blur-[24px]" />
                {/* Beam 2 — sky */}
                <div className="absolute top-[25%] right-[45%] w-[1px] h-[90%] bg-sky-200 -rotate-[35deg] blur-[1px] animate-[pulse_5s_ease-in-out_infinite_1s]" />
                <div className="absolute top-[25%] right-[45%] w-[30px] h-[90%] bg-sky-400/10 -rotate-[35deg] blur-[20px]" />
                {/* Beam 3 — violet lightning */}
                <div className="absolute top-[5%] left-[8%] w-[1px] h-[110%] bg-violet-200 rotate-[25deg] blur-[1px] animate-[lightning_7s_infinite]" />
                <div className="absolute top-[5%] left-[8%] w-[60px] h-[110%] bg-violet-400/5 rotate-[25deg] blur-[30px] animate-[lightning_7s_infinite]" />
                {/* Beam 4 — far right thin */}
                <div className="absolute top-[50%] right-[5%] w-[1px] h-[80%] bg-cyan-300/50 rotate-[10deg] blur-[1px] animate-[pulse_6s_ease-in-out_infinite_2s]" />
                <div className="absolute top-[50%] right-[5%] w-[20px] h-[80%] bg-cyan-400/5 rotate-[10deg] blur-[18px]" />
                {/* Glowing orbs */}
                <div className="absolute top-[15%] left-[20%] w-64 h-64 rounded-full opacity-10 blur-3xl" style={{ background: 'radial-gradient(circle, #6366f1, transparent)' }} />
                <div className="absolute bottom-[10%] right-[15%] w-48 h-48 rounded-full opacity-10 blur-3xl" style={{ background: 'radial-gradient(circle, #8b5cf6, transparent)' }} />
            </div>

            {/* ── Light-mode beams (softer, visible in light) ── */}
            <div className="block dark:hidden absolute inset-0">
                {/* Beam 1 — indigo soft */}
                <div className="absolute top-[-10%] right-[20%] w-[2px] h-[130%] bg-indigo-400/40 -rotate-[15deg] blur-[1px] animate-[pulse_4s_ease-in-out_infinite]" />
                <div className="absolute top-[-10%] right-[20%] w-[40px] h-[130%] bg-indigo-300/10 -rotate-[15deg] blur-[28px]" />
                {/* Beam 2 — sky soft */}
                <div className="absolute top-[25%] right-[45%] w-[1px] h-[90%] bg-sky-400/40 -rotate-[35deg] blur-[1px] animate-[pulse_5s_ease-in-out_infinite_1s]" />
                <div className="absolute top-[25%] right-[45%] w-[30px] h-[90%] bg-sky-300/10 -rotate-[35deg] blur-[20px]" />
                {/* Beam 3 — violet soft */}
                <div className="absolute top-[5%] left-[8%] w-[1px] h-[110%] bg-violet-400/30 rotate-[25deg] blur-[1px] animate-[lightning_7s_infinite]" />
                <div className="absolute top-[5%] left-[8%] w-[60px] h-[110%] bg-violet-300/5 rotate-[25deg] blur-[30px] animate-[lightning_7s_infinite]" />
                {/* Glowing orbs */}
                <div className="absolute top-[15%] left-[20%] w-64 h-64 rounded-full opacity-[0.06] blur-3xl" style={{ background: 'radial-gradient(circle, #6366f1, transparent)' }} />
                <div className="absolute bottom-[10%] right-[15%] w-48 h-48 rounded-full opacity-[0.06] blur-3xl" style={{ background: 'radial-gradient(circle, #8b5cf6, transparent)' }} />
            </div>
        </div>
    );
}
