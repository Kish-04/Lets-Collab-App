'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

export default function SessionHistoryWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a] text-white p-8">Loading...</div>}>
      <SessionHistoryViewer />
    </Suspense>
  );
}

function SessionHistoryViewer() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('sessionId');
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionId) return;
    const fetchHistory = async () => {
      try {
        const res = await fetch(`http://localhost:3001/api/sessions/${sessionId}/history`);
        const data = await res.json();
        if (data.success) {
          setLogs(data.logs);
        } else {
          setError(data.message || 'Failed to fetch history');
        }
      } catch (err: any) {
        setError(err.message || 'An error occurred');
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, [sessionId]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8 font-sans">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2 tracking-tight text-white/90">
          On-Chain Permission History
        </h1>
        <p className="text-gray-400 mb-8 font-medium">Session ID: <span className="text-cyan-400 font-mono bg-cyan-950/30 px-2 py-0.5 rounded border border-cyan-900/50">{sessionId}</span></p>

        {loading ? (
          <div className="flex items-center justify-center p-12 bg-white/5 rounded-xl border border-white/10 shadow-2xl backdrop-blur-sm">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div>
            <span className="ml-4 text-cyan-400/80 font-medium">Querying Sepolia Blockchain...</span>
          </div>
        ) : error ? (
          <div className="bg-red-950/30 border border-red-900/50 text-red-400 p-6 rounded-xl shadow-2xl backdrop-blur-sm flex items-start gap-4">
            <svg className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            <div>
                <h3 className="font-bold text-red-300">Error Loading History</h3>
                <p className="mt-1">{error}</p>
            </div>
          </div>
        ) : logs.length === 0 ? (
          <div className="bg-white/5 border border-white/10 text-gray-300 p-12 rounded-xl text-center shadow-2xl backdrop-blur-sm">
            <svg className="w-16 h-16 mx-auto text-gray-500 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            <h3 className="text-xl font-bold text-white/80">No On-Chain History Found</h3>
            <p className="mt-2 text-gray-400">There are no verifiable events recorded on the blockchain for this session yet.</p>
          </div>
        ) : (
          <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-white/10 before:to-transparent">
            {logs.map((log, index) => (
              <div key={index} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border-2 border-[#0a0a0a] bg-cyan-900 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 text-cyan-300 ring-2 ring-cyan-500/20">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                </div>
                
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-5 rounded-xl bg-white/5 border border-white/10 shadow-xl backdrop-blur-md transition-all hover:bg-white/10 hover:border-cyan-500/30">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold text-cyan-400 tracking-wide text-sm">{log.eventType}</span>
                    <time className="text-xs font-mono text-gray-500 bg-black/40 px-2 py-1 rounded">
                      {new Date(log.timestamp * 1000).toLocaleString()}
                    </time>
                  </div>
                  <div className="space-y-2 text-sm">
                    {log.hostEmail && log.hostEmail !== 'Unknown Hash' && (
                        <p className="flex justify-between border-b border-white/5 pb-1"><span className="text-gray-400">Host:</span> <span className="font-medium">{log.hostEmail}</span></p>
                    )}
                    {log.controllerEmail && log.controllerEmail !== 'Unknown Hash' && (
                        <p className="flex justify-between border-b border-white/5 pb-1"><span className="text-gray-400">Controller:</span> <span className="font-medium text-emerald-400">{log.controllerEmail}</span></p>
                    )}
                    <a
                      href={`https://sepolia.etherscan.io/tx/${log.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 mt-3 text-xs text-blue-400 hover:text-blue-300 transition-colors bg-blue-500/10 hover:bg-blue-500/20 px-3 py-1.5 rounded-md font-mono"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                      {log.txHash.substring(0, 10)}...{log.txHash.substring(log.txHash.length - 8)}
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
