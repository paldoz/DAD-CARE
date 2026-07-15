'use client';

import { useState } from 'react';
import { mutate } from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Loader2 } from 'lucide-react';

interface AddCustomerProps {
    onSuccess: () => void;
    trigger?: React.ReactNode;
    nextId?: string;
}

export function AddCustomerDialog({ onSuccess, trigger, nextId }: AddCustomerProps) {
    const [open, setOpen] = useState(false);
    const [customerId, setCustomerId] = useState(nextId || '');
    const [name, setName] = useState('');
    const [gender, setGender] = useState('');
    const [phone, setPhone] = useState('');
    const [loading, setLoading] = useState(false);

    // Update ID when nextId changes and modal is closed (to prepare for next open)
    // Actually better to just set it when it opens
    const handleOpenChange = (newOpen: boolean) => {
        setOpen(newOpen);
        if (newOpen && nextId) {
            setCustomerId(nextId);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const token = typeof window !== 'undefined' ? localStorage.getItem('dadwork_session_token') || '' : '';
            const res = await fetch('/api/customers', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'x-session-token': token } : {})
                },
                body: JSON.stringify({
                    customer_code: customerId,
                    name,
                    gender,
                    phone
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to create customer');
            }

            toast.success('Customer added!');
            mutate('/api/dashboard');
            mutate('/api/customers?lite=true');
            setCustomerId('');
            setName('');
            setGender('');
            setPhone('');
            setOpen(false);
            onSuccess();
        } catch (error: any) {
            toast.error(error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground">
                        <Plus className="w-4 h-4 mr-1" />
                        Add
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
                <DialogHeader>
                    <DialogTitle className="text-foreground">Add New Customer</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label className="text-sm font-medium text-foreground">Customer ID</Label>
                        <Input
                            value={customerId}
                            onChange={(e) => setCustomerId(e.target.value)}
                            placeholder="e.g. 1, 2, 3..."
                            required
                            className="bg-background border-border text-foreground"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label className="text-sm font-medium text-foreground">Name</Label>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Customer name..."
                            required
                            className="bg-background border-border text-foreground"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label className="text-sm font-medium text-foreground">Gender</Label>
                        <RadioGroup value={gender} onValueChange={setGender} className="flex gap-4">
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="Male" id="male" />
                                <Label htmlFor="male" className="text-foreground">Male</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="Female" id="female" />
                                <Label htmlFor="female" className="text-foreground">Female</Label>
                            </div>
                        </RadioGroup>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-sm font-medium text-foreground">Phone Number</Label>
                        <Input
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="Phone number..."
                            type="tel"
                            className="bg-background border-border text-foreground"
                        />
                    </div>

                    <Button
                        type="submit"
                        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                        disabled={loading}
                    >
                        {loading ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        ) : null}
                        {loading ? 'Creating...' : 'Create Customer'}
                    </Button>
                </form>
            </DialogContent>
        </Dialog>
    );
}
