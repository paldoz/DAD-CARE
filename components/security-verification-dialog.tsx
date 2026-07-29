'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ShieldAlert, Lock, Key, AlertTriangle, ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SecurityVerificationDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
    title?: string | React.ReactNode;
    description?: string | React.ReactNode;
    isProcessing?: boolean;
    expectedPin1?: string;
    expectedPin2?: string;
}

export function SecurityVerificationDialog({
    isOpen,
    onOpenChange,
    onConfirm,
    title = 'Security Verification',
    description = 'This is a restricted action. Please verify your identity.',
    isProcessing = false,
    expectedPin1 = '2919',
    expectedPin2 = '2135'
}: SecurityVerificationDialogProps) {
    const [step, setStep] = useState(1);
    const [pin1, setPin1] = useState('');
    const [pin2, setPin2] = useState('');
    const [error, setError] = useState('');

    // Reset state when dialog opens/closes
    useEffect(() => {
        if (isOpen) {
            setStep(1);
            setPin1('');
            setPin2('');
            setError('');
        }
    }, [isOpen]);

    const handleNextStep1 = () => {
        if (pin1 === expectedPin1) {
            setError('');
            setStep(2);
        } else {
            setError('Invalid Verification PIN 1');
            setPin1('');
        }
    };

    const handleNextStep2 = () => {
        if (pin2 === expectedPin2) {
            setError('');
            setStep(3);
        } else {
            setError('Invalid Verification PIN 2');
            setPin2('');
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent, stepNum: number) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (stepNum === 1) handleNextStep1();
            if (stepNum === 2) handleNextStep2();
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            {/* Custom high-end glassmorphism dialog content - Highly transparent and compact */}
            <DialogContent className="sm:max-w-[340px] bg-background/20 backdrop-blur-[60px] border border-white/10 dark:border-white/5 shadow-[0_30px_80px_rgba(0,0,0,0.6)] p-0 overflow-hidden z-[100000] rounded-3xl">
                
                {/* Futuristic background meshes */}
                <div className="absolute top-[-50%] left-[-50%] w-[200%] h-[200%] pointer-events-none opacity-50 dark:opacity-30 mix-blend-screen bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/30 via-background to-background" />
                <div className="absolute bottom-[-50%] right-[-50%] w-[200%] h-[200%] pointer-events-none opacity-40 dark:opacity-20 mix-blend-screen bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-destructive/20 via-background to-background" />

                <div className="relative z-10 flex flex-col h-full">
                    {/* Header Section */}
                    <div className="p-8 pb-6 flex flex-col items-center text-center relative">
                        {/* Glow behind icon */}
                        <div className={cn(
                            "absolute top-8 w-24 h-24 rounded-full blur-[40px] transition-colors duration-700",
                            step === 3 ? 'bg-destructive/40' : 
                            step === 2 ? 'bg-amber-500/40' : 
                            'bg-primary/40'
                        )} />

                        <div className={cn(
                            "p-3 rounded-2xl mb-3 transition-all duration-700 relative z-10 backdrop-blur-md border shadow-2xl",
                            step === 3 ? 'bg-destructive/10 text-destructive border-destructive/20' : 
                            step === 2 ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' : 
                            'bg-primary/10 text-primary border-primary/20'
                        )}>
                            {step === 3 ? <AlertTriangle className="w-8 h-8 animate-pulse" /> : 
                             step === 2 ? <Key className="w-8 h-8" /> : 
                             <Lock className="w-8 h-8" />}
                        </div>
                        <DialogTitle className="text-2xl font-black uppercase tracking-[0.15em] text-foreground drop-shadow-md">
                            {title}
                        </DialogTitle>
                        <DialogDescription className="text-sm font-medium text-muted-foreground mt-2 max-w-[300px] leading-relaxed">
                            {step === 3 ? 'Final confirmation required' : description}
                        </DialogDescription>

                        {/* Premium Progress Indicators */}
                        <div className="flex items-center justify-center gap-2 mt-4">
                            <div className={cn("h-1 rounded-full transition-all duration-700 shadow-[0_0_10px_rgba(var(--primary),0.5)]", step >= 1 ? 'w-8 bg-primary' : 'w-3 bg-white/10')} />
                            <div className={cn("h-1 rounded-full transition-all duration-700", step >= 2 ? 'w-8 bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]' : 'w-3 bg-white/10')} />
                            <div className={cn("h-1 rounded-full transition-all duration-700", step >= 3 ? 'w-8 bg-destructive shadow-[0_0_10px_rgba(239,68,68,0.5)]' : 'w-3 bg-white/10')} />
                        </div>
                    </div>

                    {/* Content Section */}
                    <div className="p-8 pt-2">
                        {/* Step 1: First Condition Layer */}
                        {step === 1 && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500 fill-mode-both">
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-black uppercase tracking-[0.2em] text-foreground/80">
                                            Layer 1 Auth
                                        </label>
                                        <span className="flex items-center gap-1.5 text-[10px] uppercase font-black text-primary bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-full">
                                            <ShieldCheck className="w-3 h-3" /> Pin 1
                                        </span>
                                    </div>
                                    <div className="relative group">
                                        <div className="absolute inset-0 bg-primary/20 blur-xl rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500" />
                                        <div className="relative">
                                            <Lock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                            <Input
                                                type="password"
                                                inputMode="numeric"
                                                pattern="[0-9]*"
                                                autoFocus
                                                value={pin1}
                                                onChange={(e) => setPin1(e.target.value.replace(/\D/g, ''))}
                                                onKeyDown={(e) => handleKeyDown(e, 1)}
                                                className="h-11 pl-9 pr-12 text-center text-xl tracking-[0.5em] font-black bg-black/20 dark:bg-black/40 border-white/10 rounded-xl focus-visible:ring-primary/50 shadow-inner"
                                                placeholder="••••"
                                                maxLength={4}
                                            />
                                        </div>
                                    </div>
                                    {error && <p className="text-xs font-bold text-destructive text-center animate-in shake">{error}</p>}
                                </div>
                                <Button 
                                    onClick={handleNextStep1} 
                                    disabled={!pin1}
                                    className="w-full h-14 rounded-2xl font-black uppercase tracking-widest bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_10px_40px_-10px_rgba(var(--primary),0.8)] active:scale-[0.98] transition-all group overflow-hidden relative"
                                >
                                    <span className="relative z-10 flex items-center justify-center">
                                        Continue <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1.5 transition-transform" />
                                    </span>
                                </Button>
                            </div>
                        )}

                        {/* Step 2: Second Condition Layer */}
                        {step === 2 && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500 fill-mode-both">
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-black uppercase tracking-[0.2em] text-foreground/80">
                                            Layer 2 Auth
                                        </label>
                                        <span className="flex items-center gap-1.5 text-[10px] uppercase font-black text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full">
                                            <Key className="w-3 h-3" /> Pin 2
                                        </span>
                                    </div>
                                    <div className="relative group">
                                        <div className="absolute inset-0 bg-amber-500/20 blur-xl rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500" />
                                        <div className="relative">
                                            <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground/40 group-focus-within:text-amber-500 transition-colors" />
                                            <Input
                                                type="password"
                                                inputMode="numeric"
                                                placeholder="••••"
                                                className="h-16 pl-12 bg-background/50 backdrop-blur-md border-white/10 text-center tracking-[1em] font-black text-2xl rounded-2xl focus:border-amber-500/50 focus:ring-amber-500/50 transition-all shadow-inner"
                                                value={pin2}
                                                onChange={(e) => { setPin2(e.target.value); setError(''); }}
                                                onKeyDown={(e) => handleKeyDown(e, 2)}
                                                autoFocus
                                            />
                                        </div>
                                    </div>
                                    {error && <p className="text-xs font-bold text-destructive text-center animate-in shake">{error}</p>}
                                </div>
                                <Button 
                                    onClick={handleNextStep2} 
                                    disabled={!pin2}
                                    className="w-full h-14 rounded-2xl font-black uppercase tracking-widest bg-amber-500 hover:bg-amber-600 text-white shadow-[0_10px_40px_-10px_rgba(245,158,11,0.8)] active:scale-[0.98] transition-all group overflow-hidden relative"
                                >
                                    <span className="relative z-10 flex items-center justify-center">
                                        Verify <CheckCircle2 className="w-5 h-5 ml-2 group-hover:scale-110 group-hover:rotate-12 transition-transform" />
                                    </span>
                                </Button>
                            </div>
                        )}

                        {/* Step 3: Final Warning Layer */}
                        {step === 3 && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700 fill-mode-both">
                                <div className="bg-destructive/10 backdrop-blur-md border border-destructive/30 rounded-2xl p-5 relative overflow-hidden shadow-[inset_0_0_30px_rgba(239,68,68,0.1)]">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-destructive/20 rounded-full blur-[30px] pointer-events-none -mr-16 -mt-16" />
                                    <h4 className="text-destructive font-black text-sm uppercase tracking-widest mb-3 flex items-center gap-2 relative z-10">
                                        <ShieldAlert className="w-5 h-5" />
                                        Critical Action
                                    </h4>
                                    <p className="text-sm text-foreground/90 font-medium leading-relaxed relative z-10">
                                        Verification passed. Are you absolutely certain you want to proceed? 
                                        <strong className="block mt-3 font-black text-destructive/90 bg-destructive/10 p-2.5 rounded-xl border border-destructive/20">
                                            This action is irreversible and will permanently destroy the selected data.
                                        </strong>
                                    </p>
                                </div>
                                
                                <div className="flex gap-3">
                                    <Button 
                                        variant="outline" 
                                        className="flex-1 h-14 rounded-2xl font-bold uppercase tracking-widest text-xs border-white/10 hover:bg-white/5 active:scale-[0.98] transition-all backdrop-blur-sm"
                                        onClick={() => onOpenChange(false)}
                                        disabled={isProcessing}
                                    >
                                        Cancel
                                    </Button>
                                    <Button 
                                        onClick={onConfirm}
                                        disabled={isProcessing}
                                        className="flex-[2] h-14 rounded-2xl font-black uppercase tracking-widest text-sm bg-destructive hover:bg-destructive/90 text-white shadow-[0_10px_40px_-10px_rgba(239,68,68,0.8)] active:scale-[0.98] transition-all relative overflow-hidden"
                                    >
                                        {isProcessing ? (
                                            <span className="flex items-center gap-2">
                                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                Processing
                                            </span>
                                        ) : 'Proceed & Destroy'}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
