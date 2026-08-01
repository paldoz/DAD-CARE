import React from 'react';
import pool from '@/lib/db';
import { getAllCustomerStats } from '@/app/utils/rankHelpers';
import { calculateCustomerReliability } from '@/app/utils/ledgerHelpers';

export const dynamic = 'force-dynamic';

export default async function ReliabilityAuditPage() {
    // 1. Fetch raw data
    const customersQuery = `SELECT id, name, customer_code, created_at FROM "Customer" WHERE deleted_at IS NULL ORDER BY name ASC`;
    const ledgerQuery = `SELECT id, type, amount, created_at, reference_date, customer_id, maqal_id, receipt_id, previous_debt, new_debt FROM "Ledger" WHERE deleted_at IS NULL ORDER BY COALESCE(reference_date::date, created_at::date) ASC, created_at ASC`;
    
    const [customersRes, ledgerRes] = await Promise.all([
        pool.query(customersQuery),
        pool.query(ledgerQuery)
    ]);

    const customers = customersRes.rows;
    const allLedger = ledgerRes.rows;

    // Group ledger by customer
    const ledgerByCustomer = new Map<string, any[]>();
    for (const txn of allLedger) {
        if (!ledgerByCustomer.has(txn.customer_id)) {
            ledgerByCustomer.set(txn.customer_id, []);
        }
        ledgerByCustomer.get(txn.customer_id)!.push(txn);
    }

    // 2. Run engine for every customer
    const auditData = customers.map(c => {
        const txns = ledgerByCustomer.get(c.id) || [];
        // calculateCustomerReliability returns the score and the debug payload
        const { score, debugMaqals } = calculateCustomerReliability(txns);
        
        return {
            customer: c,
            score,
            debugMaqals,
            txnCount: txns.length
        };
    });

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8 bg-zinc-950 min-h-screen text-zinc-100 font-mono">
            <div className="space-y-4">
                <h1 className="text-3xl font-black text-emerald-400 tracking-tight">FINAL RELIABILITY SYSTEM AUDIT</h1>
                <p className="text-zinc-400 text-sm">
                    This dashboard strictly implements the 15 Business Rules. It uses the exact same unified JavaScript engine 
                    (<code className="bg-zinc-900 px-1 py-0.5 rounded text-zinc-300">calculateCustomerReliability</code>) used by the Customer Profile.
                    It ignores the current open Maqal and exclusively uses the last 5 completed Maqals.
                </p>
            </div>

            <div className="space-y-12">
                {auditData.map((data) => (
                    <div key={data.customer.id} className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl">
                        <div className="bg-zinc-900 p-4 border-b border-zinc-800 flex justify-between items-center">
                            <div>
                                <h2 className="text-xl font-bold text-white flex items-center gap-3">
                                    {data.customer.name}
                                    <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-1 rounded-full font-medium">#{data.customer.customer_code}</span>
                                </h2>
                                <p className="text-xs text-zinc-500 mt-1">Total Transactions: {data.txnCount}</p>
                            </div>
                            <div className="text-right">
                                <div className="text-xs text-zinc-400 uppercase tracking-wider font-semibold mb-1">Final Reliability Score</div>
                                <div className="text-4xl font-black text-emerald-400">{data.score}%</div>
                            </div>
                        </div>

                        <div className="p-6">
                            {data.debugMaqals.length === 0 ? (
                                <div className="text-zinc-500 italic text-sm py-4">No completed Maqals found. Default score applied (100%).</div>
                            ) : (
                                <div className="space-y-4">
                                    <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4">Last {data.debugMaqals.length} Completed Maqals Used</h3>
                                    
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm text-left">
                                            <thead className="text-xs text-zinc-500 uppercase bg-zinc-900/50">
                                                <tr>
                                                    <th className="px-4 py-3 font-semibold rounded-tl-lg">Maqal Title</th>
                                                    <th className="px-4 py-3 font-semibold">Total Debt</th>
                                                    <th className="px-4 py-3 font-semibold">Total Paid</th>
                                                    <th className="px-4 py-3 font-semibold">UI Percentage</th>
                                                    <th className="px-4 py-3 font-semibold">Weight</th>
                                                    <th className="px-4 py-3 font-semibold rounded-tr-lg text-right">Contribution</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-zinc-800/50">
                                                {data.debugMaqals.map((m: any, idx: number) => (
                                                    <tr key={m.id} className="hover:bg-zinc-800/20 transition-colors">
                                                        <td className="px-4 py-3 font-medium text-zinc-300">{m.title}</td>
                                                        <td className="px-4 py-3 text-rose-400">${m.debt.toLocaleString()}</td>
                                                        <td className="px-4 py-3 text-emerald-400">${m.paid.toLocaleString()}</td>
                                                        <td className="px-4 py-3 text-sky-400 font-bold">{m.percentage}%</td>
                                                        <td className="px-4 py-3 text-amber-400">{m.weight * 100}%</td>
                                                        <td className="px-4 py-3 text-right font-bold text-white">{m.contribution.toFixed(2)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot className="bg-zinc-900/50 text-white font-bold">
                                                <tr>
                                                    <td colSpan={4} className="px-4 py-4 rounded-bl-lg">Raw Total Score</td>
                                                    <td className="px-4 py-4 text-amber-400">
                                                        {(data.debugMaqals.reduce((sum: number, m: any) => sum + m.weight, 0) * 100).toFixed(0)}%
                                                    </td>
                                                    <td className="px-4 py-4 text-right text-emerald-400 text-lg rounded-br-lg">
                                                        {data.debugMaqals.reduce((sum: number, m: any) => sum + m.contribution, 0).toFixed(2)}
                                                    </td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                    
                                    <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                                        <p className="text-emerald-400 text-sm">
                                            <strong>Mathematical Proof:</strong> The raw total score is divided by the total active weight to ensure new customers are not penalized for having fewer than 5 Maqals.
                                            <br/>
                                            {data.debugMaqals.reduce((sum: number, m: any) => sum + m.contribution, 0).toFixed(2)} ÷ {data.debugMaqals.reduce((sum: number, m: any) => sum + m.weight, 0).toFixed(2)} = <strong>{data.score} (Rounded)</strong>
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
