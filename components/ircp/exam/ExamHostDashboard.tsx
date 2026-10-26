import React, { useState, useRef, useEffect } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type * as Y from 'yjs';
import { observePeerDocs } from '@/lib/CrdtSync';
import {
    type ExamQuestion, type ExamAnswer, type ExamAnswers,
    runExamCode, secondsLeft, formatCountdown, answerStatus, examResultRows, gradedQuestionCount, examResultsCsv, optionTally,
} from '@/lib/examClient';

export type { ExamQuestion, ExamAnswer } from '@/lib/examClient';

const defaultSnippets: Record<string, string> = {
    python: 'def solve():\n    pass\n\nif __name__ == "__main__":\n    solve()',
    javascript: 'function solve() {\n\n}\n\nsolve();',
    java: 'public class Main {\n    public static void main(String[] args) {\n        \n    }\n}',
    c: '#include <stdio.h>\n\nint main() {\n    return 0;\n}',
    cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    return 0;\n}',
    rust: 'fn main() {\n    \n}',
    go: 'package main\n\nimport "fmt"\n\nfunc main() {\n    \n}',
    typescript: 'function solve(): void {\n\n}\n\nsolve();',
    html: '<!DOCTYPE html>\n<html>\n<head>\n    <title>Page Title</title>\n</head>\n<body>\n    \n</body>\n</html>'
};

// Time limits the host can pick when sending a question (seconds; 0 = no limit)
const TIME_LIMITS: { label: string; seconds: number }[] = [
    { label: 'No time limit', seconds: 0 },
    { label: '30 seconds', seconds: 30 },
    { label: '1 minute', seconds: 60 },
    { label: '2 minutes', seconds: 120 },
    { label: '5 minutes', seconds: 300 },
    { label: '10 minutes', seconds: 600 },
    { label: '15 minutes', seconds: 900 },
    { label: '30 minutes', seconds: 1800 },
    { label: '1 hour', seconds: 3600 },
];

const STATUS_STYLE: Record<ReturnType<typeof answerStatus>, { label: string; className: string }> = {
    correct: { label: 'Correct', className: 'bg-green-500/20 text-green-400 border border-green-500/30' },
    wrong: { label: 'Incorrect', className: 'bg-red-500/20 text-red-400 border border-red-500/30' },
    review: { label: 'Needs review', className: 'bg-purple-500/20 text-purple-300 border border-purple-500/30' },
    submitted: { label: 'Submitted', className: 'bg-green-500/20 text-green-400 border border-green-500/30' },
    draft: { label: 'Drafting', className: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' },
    none: { label: '—', className: 'text-[var(--text-secondary)]' },
};

const newQuestionId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

// Read-only view of a candidate's code, streamed keystroke-by-keystroke over the CRDT channel.
// Falls back to the last draft received through the server when no peer-to-peer copy exists yet.
function LiveCodeView({ doc, questionId, fallback, language }: { doc?: Y.Doc; questionId: string; fallback: string; language: string }) {
    const [liveText, setLiveText] = useState<string | null>(null);

    useEffect(() => {
        if (!doc) return;
        const yText = doc.getText(`monaco:${questionId}`);
        const update = () => setLiveText(yText.length > 0 ? yText.toString() : null);
        update();
        yText.observe(update);
        return () => yText.unobserve(update);
    }, [doc, questionId]);

    return (
        <div className="relative h-full">
            {liveText !== null && (
                <span className="absolute top-2 right-3 z-10 text-[9px] uppercase font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">Live</span>
            )}
            <MonacoEditor
                height="100%"
                language={language}
                theme="vs-dark"
                value={liveText ?? fallback}
                options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13, padding: { top: 12 } }}
            />
        </div>
    );
}

interface ExamHostDashboardProps {
    /** Every question of the exam, from the server (survives a reload of the host's window) */
    questions: ExamQuestion[];
    onPushQuestion: (question: ExamQuestion) => void;
    onCloseQuestion: (questionId: string) => void;
    onGradeAnswer: (questionId: string, controllerId: string, correct: boolean) => void;
    liveAnswers: ExamAnswers;
    localStream?: MediaStream | null;
}

export function ExamHostDashboard({ questions, onPushQuestion, onCloseQuestion, onGradeAnswer, liveAnswers, localStream }: ExamHostDashboardProps) {
    const [questionType, setQuestionType] = useState<ExamQuestion['type']>('freeform');
    const [prompt, setPrompt] = useState('');
    const [options, setOptions] = useState<string[]>(['', '']);
    const [language, setLanguage] = useState('python');
    const [starterCode, setStarterCode] = useState(defaultSnippets['python']);
    const [hostOutput, setHostOutput] = useState('');
    const [isRunning, setIsRunning] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [voicePrompt, setVoicePrompt] = useState<string | null>(null);
    const [timeLimitSec, setTimeLimitSec] = useState(0);
    const [formError, setFormError] = useState('');
    const [view, setView] = useState<'responses' | 'results'>('responses');
    const [candidateDocs, setCandidateDocs] = useState<Record<string, Y.Doc>>({});
    const [answerKey, setAnswerKey] = useState<string>('');
    const [currentReviewIndex, setCurrentReviewIndex] = useState<number>(0);
    const [now, setNow] = useState(() => Date.now());
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const knownCountRef = useRef(questions.length);

    useEffect(() => {
        const { dispose } = observePeerDocs('exam-code', (peerId, doc) => {
            setCandidateDocs(prev => ({ ...prev, [peerId]: doc }));
        });
        return dispose;
    }, []);

    // A newly sent question is shown straight away
    useEffect(() => {
        if (questions.length > knownCountRef.current) setCurrentReviewIndex(questions.length - 1);
        knownCountRef.current = questions.length;
    }, [questions.length]);

    // Countdown for timed questions that are still open
    const anyTimed = questions.some(q => !q.closed && typeof q.endsAt === 'number');
    useEffect(() => {
        if (!anyTimed) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [anyTimed]);

    const toggleRecording = async () => {
        if (isRecording) {
            mediaRecorderRef.current?.stop();
            // Only stop the tracks if we created a new stream (not using the shared localStream)
            if (!localStream || mediaRecorderRef.current?.stream !== localStream) {
                mediaRecorderRef.current?.stream.getTracks().forEach(t => t.stop());
            }
            setIsRecording(false);
            return;
        }

        try {
            let stream = localStream;
            if (!stream || stream.getAudioTracks().length === 0) {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }

            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunksRef.current.push(event.data);
            };

            mediaRecorder.onstop = () => {
                const mimeType = mediaRecorder.mimeType || 'audio/webm';
                const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = () => {
                    setVoicePrompt(reader.result as string);
                };
            };

            mediaRecorder.start();
            setIsRecording(true);
        } catch {
            alert('Microphone access denied or not available.');
        }
    };

    const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newLang = e.target.value;
        setLanguage(newLang);
        setStarterCode(defaultSnippets[newLang] || '');
        setHostOutput('');
    };

    const runHostCode = async () => {
        if (!starterCode) return;
        setIsRunning(true);
        setHostOutput('Running...');
        try {
            const { output } = await runExamCode(language, starterCode);
            setHostOutput(output);
        } finally {
            setIsRunning(false);
        }
    };

    const handleSend = () => {
        setFormError('');
        if (isRecording) {
            setFormError('Stop the voice recording first.');
            return;
        }
        if (!prompt.trim()) {
            // The server needs a written prompt (it is also what the results show)
            setFormError(voicePrompt ? 'Add a short written prompt to go with the voice recording.' : 'Type the question first.');
            return;
        }
        const choices = options.map(o => o.trim()).filter(Boolean);
        if ((questionType === 'mc' || questionType === 'poll') && choices.length < 2) {
            setFormError('Add at least two options.');
            return;
        }
        if (questionType === 'mc' && answerKey && !choices.includes(answerKey)) {
            setFormError('The correct option is no longer in the list; pick it again.');
            return;
        }

        const q: ExamQuestion = {
            id: newQuestionId(),
            type: questionType,
            prompt: prompt,
            voicePrompt: voicePrompt || undefined,
            answerKey: questionType === 'poll' ? undefined : answerKey.trim() || undefined,
            timeLimitSec: timeLimitSec || undefined,
        };
        if (questionType === 'mc' || questionType === 'poll') {
            q.options = choices;
        }
        if (questionType === 'code') {
            q.language = language;
            q.starterCode = starterCode;
        }
        onPushQuestion(q);
        setPrompt('');
        setVoicePrompt(null);
        setOptions(['', '']);
        setAnswerKey('');
    };

    const exportResults = () => {
        const csv = examResultsCsv(questions, liveAnswers);
        const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `exam-results-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const reviewIndex = Math.min(currentReviewIndex, Math.max(0, questions.length - 1));
    const rows = examResultRows(questions, liveAnswers);
    const gradedCount = gradedQuestionCount(questions, liveAnswers);

    const timeBadge = (q: ExamQuestion) => {
        const left = secondsLeft(q, now);
        if (q.closed || left === 0) return <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded-full bg-[var(--bg)] text-[var(--text-secondary)] border border-[var(--border)]">Closed</span>;
        if (left === null) return <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/30">Open</span>;
        return <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${left <= 30 ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-blue-500/10 text-blue-300 border-blue-500/30'}`}>{formatCountdown(left)} left</span>;
    };

    return (
        <div className="w-full h-full flex flex-col p-6 font-sans text-[var(--text-primary)] overflow-y-auto overflow-x-hidden custom-scrollbar">
            <h2 className="text-2xl font-black mb-6 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent tracking-tight">Exam Dashboard</h2>

            <div className="flex flex-col gap-4 mb-8 p-5 bg-[var(--elevated)] border border-[var(--border)]/60 rounded-2xl backdrop-blur-md shadow-inner">
                <h3 className="font-bold text-sm tracking-wide text-[var(--text-primary)] uppercase">Create Question</h3>

                <div className="grid grid-cols-2 gap-3">
                    <div className="relative">
                        <select
                            value={questionType}
                            onChange={(e) => { setQuestionType(e.target.value as ExamQuestion['type']); setAnswerKey(''); setFormError(''); }}
                            aria-label="Question type"
                            className="w-full bg-[var(--bg)]/70 border border-[var(--border)]/60 rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all cursor-pointer"
                        >
                            <option value="freeform">Freeform (Text/Voice)</option>
                            <option value="mc">Multiple Choice</option>
                            <option value="poll">Live Poll</option>
                            <option value="code">Coding</option>
                        </select>
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-primary)]">▼</div>
                    </div>
                    <div className="relative">
                        <select
                            value={timeLimitSec}
                            onChange={(e) => setTimeLimitSec(Number(e.target.value))}
                            aria-label="Time limit"
                            title="Enforced by the server: when it runs out, each candidate's last saved draft is submitted"
                            className="w-full bg-[var(--bg)]/70 border border-[var(--border)]/60 rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all cursor-pointer"
                        >
                            {TIME_LIMITS.map(limit => <option key={limit.seconds} value={limit.seconds}>{limit.label}</option>)}
                        </select>
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-primary)]">▼</div>
                    </div>
                </div>

                <div className="relative">
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="Type your question..."
                        className="w-full bg-[var(--bg)]/70 border border-[var(--border)]/60 rounded-xl p-4 pb-16 text-sm min-h-[100px] text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all resize-none shadow-inner"
                    />

                    {voicePrompt && (
                        <div className="absolute bottom-12 left-4 right-4 flex items-center gap-2 bg-[var(--bg)]/60 p-1.5 rounded-lg border border-[var(--border)]/60 backdrop-blur-md">
                            <audio src={voicePrompt} controls className="h-6 w-full" />
                            <button onClick={() => setVoicePrompt(null)} className="text-red-400 hover:text-red-300 px-2 font-bold shrink-0" aria-label="Remove recording">×</button>
                        </div>
                    )}

                    <button
                        onClick={toggleRecording}
                        className={`absolute bottom-2 right-2 px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-2 transition-all ${isRecording ? 'bg-red-500/20 text-red-400 border border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.2)] animate-pulse' : 'bg-[var(--elevated)] text-[var(--text-primary)] border border-[var(--border)]/60 hover:bg-[var(--elevated)]/80 hover:text-[var(--text-primary)]'}`}
                    >
                        {isRecording ? (
                            <><span className="w-2 h-2 rounded-full bg-red-400" /> Recording...</>
                        ) : (
                            <>🎤 Record Voice</>
                        )}
                    </button>
                </div>

                {(questionType === 'mc' || questionType === 'poll') && (
                    <div className="flex flex-col gap-3">
                        {options.map((opt, i) => (
                            <div key={i} className="flex items-center gap-2">
                                {questionType === 'mc' && (
                                    <input
                                        type="radio"
                                        name="exam-correct-option"
                                        checked={Boolean(opt.trim()) && answerKey === opt.trim()}
                                        disabled={!opt.trim()}
                                        onChange={() => setAnswerKey(opt.trim())}
                                        title="Mark as the correct option (used for automatic grading)"
                                        aria-label={`Option ${i + 1} is correct`}
                                        className="accent-green-500 shrink-0"
                                    />
                                )}
                                <input
                                    type="text"
                                    value={opt}
                                    onChange={(e) => {
                                        const newOpts = [...options];
                                        if (answerKey && answerKey === newOpts[i].trim()) setAnswerKey(e.target.value.trim());
                                        newOpts[i] = e.target.value;
                                        setOptions(newOpts);
                                    }}
                                    placeholder={`Option ${i + 1}`}
                                    className="w-full bg-[var(--bg)]/70 border border-[var(--border)]/60 rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                                />
                                {options.length > 2 && (
                                    <button
                                        onClick={() => {
                                            if (answerKey === opt.trim()) setAnswerKey('');
                                            setOptions(options.filter((_, index) => index !== i));
                                        }}
                                        className="text-red-400 hover:text-red-300 font-bold px-2 shrink-0"
                                        aria-label={`Remove option ${i + 1}`}
                                    >
                                        ×
                                    </button>
                                )}
                            </div>
                        ))}
                        {options.length < 20 && (
                            <button
                                onClick={() => setOptions([...options, ''])}
                                className="text-xs font-semibold text-blue-400 text-left hover:text-blue-300 transition-colors py-1 flex items-center gap-1"
                            >
                                <span className="text-lg">+</span> Add Option
                            </button>
                        )}
                        {questionType === 'mc' && (
                            <p className="text-[11px] text-[var(--text-secondary)]">Select the correct option to grade answers automatically (optional).</p>
                        )}
                    </div>
                )}

                {questionType === 'code' && (
                    <div className="flex flex-col gap-3">
                        <div className="relative">
                            <select
                                value={language}
                                onChange={handleLanguageChange}
                                aria-label="Language"
                                className="w-full bg-[var(--bg)]/70 border border-[var(--border)]/60 rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all cursor-pointer"
                            >
                                <option value="python">Python</option>
                                <option value="javascript">JavaScript</option>
                                <option value="typescript">TypeScript</option>
                                <option value="java">Java</option>
                                <option value="c">C</option>
                                <option value="cpp">C++</option>
                                <option value="rust">Rust</option>
                                <option value="go">Go</option>
                                <option value="html">HTML</option>
                            </select>
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-primary)]">▼</div>
                        </div>

                        <div className="h-64 border border-[var(--border)]/60 rounded-xl overflow-hidden shadow-inner bg-[var(--bg)]/60 relative">
                            <MonacoEditor
                                height="100%"
                                language={language}
                                theme="vs-dark"
                                value={starterCode}
                                onChange={(val) => setStarterCode(val || '')}
                                options={{ minimap: { enabled: false }, fontSize: 13, padding: { top: 12 } }}
                            />
                        </div>

                        <div className="flex justify-end mt-1">
                            <button
                                onClick={runHostCode}
                                disabled={isRunning}
                                className="bg-green-500/10 text-green-400 border border-green-500/30 px-4 py-1.5 rounded-lg font-bold text-xs hover:bg-green-500/20 transition-colors flex items-center gap-1 disabled:opacity-50"
                            >
                                {isRunning ? 'Running...' : '▶ Run Code'}
                            </button>
                        </div>

                        {hostOutput && (
                            <div className="p-3 bg-[var(--bg)]/80 border border-[var(--border)] rounded-xl font-mono text-[11px] text-green-400/90 whitespace-pre-wrap max-h-32 overflow-y-auto shadow-inner custom-scrollbar">
                                {hostOutput}
                            </div>
                        )}
                    </div>
                )}

                {(questionType === 'freeform' || questionType === 'code') && (
                    <div className="mt-2">
                        <input
                            type="text"
                            value={answerKey}
                            onChange={(e) => setAnswerKey(e.target.value)}
                            placeholder={questionType === 'code' ? 'Expected output (optional) - code answers are marked by you' : 'Correct answer (optional) - alternatives separated by |'}
                            className="w-full bg-[var(--bg)]/70 border border-[var(--border)]/60 rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all"
                        />
                    </div>
                )}
                {formError && <p className="text-xs text-red-400" role="alert">{formError}</p>}
                <button
                    onClick={handleSend}
                    className="mt-2 w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-[var(--text-primary)] font-bold py-3 rounded-xl shadow-lg hover:shadow-blue-500/25 hover:from-blue-500 hover:to-indigo-500 transition-all active:scale-[0.98]"
                >
                    Push to Controllers
                </button>
            </div>

            <div className="flex items-center justify-between mb-4">
                <div className="flex gap-1 bg-[var(--elevated)] border border-[var(--border)]/60 rounded-xl p-1">
                    {(['responses', 'results'] as const).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setView(tab)}
                            className={`px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wide transition-colors ${view === tab ? 'bg-[var(--bg)] text-[var(--text-primary)] border border-[var(--border)]/60' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                        >
                            {tab === 'responses' ? 'Live Responses' : 'Results'}
                        </button>
                    ))}
                </div>
                {view === 'results' && (
                    <button
                        onClick={exportResults}
                        disabled={rows.length === 0}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-500/10 text-blue-300 border border-blue-500/30 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                    >
                        Export CSV
                    </button>
                )}
            </div>

            {view === 'results' ? (
                rows.length === 0 ? (
                    <div className="h-32 flex items-center justify-center text-[var(--text-primary)] text-sm italic bg-[var(--elevated)] rounded-2xl border border-[var(--border)] border-dashed">
                        No answers yet.
                    </div>
                ) : (
                    <div className="overflow-x-auto bg-[var(--elevated)] border border-[var(--border)]/60 rounded-2xl p-3">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-[var(--text-secondary)]">
                                    <th className="py-1 pr-2 font-semibold">Candidate</th>
                                    {questions.map((q, i) => <th key={q.id} className="py-1 px-1 font-semibold text-center" title={q.prompt}>Q{i + 1}</th>)}
                                    <th className="py-1 pl-2 font-semibold text-right">Score</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(row => (
                                    <tr key={row.controllerId} className="border-t border-[var(--border)]/60">
                                        <td className="py-1.5 pr-2">
                                            <div className="font-semibold text-blue-300">{row.name}</div>
                                            {row.email && <div className="text-[10px] text-[var(--text-secondary)]">{row.email}</div>}
                                        </td>
                                        {questions.map(q => {
                                            const status = row.statuses[q.id] || 'none';
                                            const symbol = { correct: '✓', wrong: '✗', review: '?', submitted: '•', draft: '…', none: '—' }[status];
                                            return <td key={q.id} className={`py-1.5 px-1 text-center font-bold ${status === 'correct' ? 'text-green-400' : status === 'wrong' ? 'text-red-400' : status === 'review' ? 'text-purple-300' : 'text-[var(--text-secondary)]'}`} title={STATUS_STYLE[status].label}>{symbol}</td>;
                                        })}
                                        <td className="py-1.5 pl-2 text-right font-mono">
                                            {gradedCount > 0 ? `${row.correct}/${gradedCount}` : '—'}
                                            {row.pending > 0 && <div className="text-[10px] text-purple-300">{row.pending} to review</div>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <p className="mt-3 text-[10px] text-[var(--text-secondary)]">✓ correct · ✗ incorrect · ? needs your review · • submitted (not graded) · … still drafting. Scores count questions with an answer key or a grade you gave.</p>
                    </div>
                )
            ) : (
            <div className="flex flex-col gap-4 pr-2">
                {questions.length === 0 ? (
                    <div className="h-32 flex items-center justify-center text-[var(--text-primary)] text-sm italic bg-[var(--elevated)] rounded-2xl border border-[var(--border)] border-dashed">
                        Waiting for active questions...
                    </div>
                ) : (
                    <>
                        <div className="flex items-center justify-between bg-[var(--elevated)] border border-[var(--border)]/60 rounded-xl p-3 shadow-inner">
                            <button
                                onClick={() => setCurrentReviewIndex(Math.max(0, reviewIndex - 1))}
                                disabled={reviewIndex === 0}
                                className="px-3 py-1 bg-[var(--bg)] text-[var(--text-primary)] rounded-lg disabled:opacity-50 border border-[var(--border)]/60 hover:bg-[var(--elevated)] transition-colors text-sm font-bold"
                            >
                                ← Prev
                            </button>
                            <span className="text-sm font-medium text-[var(--text-primary)]">
                                Question {reviewIndex + 1} of {questions.length}
                            </span>
                            <button
                                onClick={() => setCurrentReviewIndex(Math.min(questions.length - 1, reviewIndex + 1))}
                                disabled={reviewIndex === questions.length - 1}
                                className="px-3 py-1 bg-[var(--bg)] text-[var(--text-primary)] rounded-lg disabled:opacity-50 border border-[var(--border)]/60 hover:bg-[var(--elevated)] transition-colors text-sm font-bold"
                            >
                                Next →
                            </button>
                        </div>

                        {(() => {
                            const qObj = questions[reviewIndex];
                            if (!qObj) return null;
                            const userAnswers = liveAnswers[qObj.id] || {};
                            const hasAnswers = Object.keys(userAnswers).length > 0;
                            const isOpen = !qObj.closed && secondsLeft(qObj, now) !== 0;
                            const tally = qObj.type === 'mc' || qObj.type === 'poll' ? optionTally(qObj, liveAnswers) : null;

                            return (
                                <div key={qObj.id} className="bg-[var(--elevated)] border border-[var(--border)]/60 rounded-2xl p-4 shadow-sm">
                                    <div className="flex items-start justify-between gap-3 mb-3">
                                        <div className="text-[var(--text-primary)] font-mono text-[10px] tracking-wider uppercase break-words">
                                            {qObj.type} · {qObj.prompt}
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {timeBadge(qObj)}
                                            {isOpen && (
                                                <button
                                                    onClick={() => {
                                                        if (window.confirm('Close this question now? Candidates who have not submitted get their current draft submitted.')) onCloseQuestion(qObj.id);
                                                    }}
                                                    className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
                                                >
                                                    Close
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {qObj.answerKey && (
                                        <div className="text-[11px] text-green-400/90 mb-3">{qObj.type === 'code' ? 'Expected output' : 'Answer key'}: {qObj.answerKey}</div>
                                    )}
                                    {tally && (
                                        <div className="flex flex-col gap-1 mb-3">
                                            {Object.entries(tally).map(([option, count]) => {
                                                const total = Object.values(tally).reduce((sum, n) => sum + n, 0);
                                                return (
                                                    <div key={option} className="text-xs">
                                                        <div className="flex justify-between"><span className={option === qObj.answerKey ? 'text-green-400 font-semibold' : ''}>{option}</span><span className="font-mono">{count}</span></div>
                                                        <div className="h-1.5 rounded-full bg-[var(--bg)] overflow-hidden"><div className="h-full bg-blue-500/60" style={{ width: total ? `${(count / total) * 100}%` : '0%' }} /></div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {!hasAnswers ? (
                                        <div className="text-sm text-[var(--text-secondary)] italic text-center py-4">No submissions yet.</div>
                                    ) : (
                                        <div className="flex flex-col gap-3">
                                            {Object.entries(userAnswers).map(([controllerId, ans]) => {
                                                const status = answerStatus(qObj, ans);
                                                return (
                                                <div key={controllerId} className="bg-[var(--bg)]/70 border border-[var(--border)] p-3 rounded-xl">
                                                    <div className="flex justify-between items-center mb-2 gap-2">
                                                        <span className="font-semibold text-sm text-blue-300">{ans.controllerName || 'Unknown'}</span>
                                                        <span className="flex items-center gap-1">
                                                            {ans.autoSubmitted && <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded-full bg-[var(--elevated)] text-[var(--text-secondary)] border border-[var(--border)]" title="Submitted automatically when the question closed">Auto</span>}
                                                            <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[status].className}`}>
                                                                {STATUS_STYLE[status].label}
                                                            </span>
                                                        </span>
                                                    </div>
                                                    {qObj.type === 'code' ? (
                                                        <div className="h-48 border border-[var(--border)]/60 rounded-xl overflow-hidden shadow-inner bg-[var(--bg)]/60 mt-2">
                                                            <LiveCodeView
                                                                doc={ans.isFinal ? undefined : candidateDocs[controllerId]}
                                                                questionId={qObj.id}
                                                                language={qObj.language || 'javascript'}
                                                                fallback={ans.text || ''}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className="text-sm text-[var(--text-primary)] break-words whitespace-pre-wrap">{ans.text || (ans.options && ans.options.join(', '))}</div>
                                                    )}

                                                    {ans.audio && (
                                                        <div className="mt-3 bg-[var(--bg)]/70 p-1.5 rounded-lg border border-[var(--border)] shadow-inner">
                                                            <audio src={ans.audio} controls className="h-8 w-full" />
                                                        </div>
                                                    )}

                                                    {ans.output && (
                                                        <div className="mt-3">
                                                            <div className="text-[9px] uppercase tracking-wide text-[var(--text-secondary)] mb-1" title="Produced in the candidate's session; not used for grading">Candidate-reported output (not verified)</div>
                                                            <div className="p-2 bg-[var(--bg)]/60 border border-[var(--border)] text-green-400 font-mono text-[11px] rounded-lg shadow-inner whitespace-pre-wrap max-h-32 overflow-y-auto">
                                                                {ans.output}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {ans.isFinal && qObj.type !== 'poll' && (
                                                        <div className="mt-3 flex items-center justify-end gap-2">
                                                            {ans.gradedBy === 'host' && <span className="text-[10px] text-[var(--text-secondary)] mr-auto">Marked by you</span>}
                                                            <button
                                                                onClick={() => onGradeAnswer(qObj.id, controllerId, true)}
                                                                disabled={ans.correct === true}
                                                                className="text-[10px] font-bold px-2 py-1 rounded-lg bg-green-500/10 text-green-400 border border-green-500/30 hover:bg-green-500/20 transition-colors disabled:opacity-40"
                                                            >
                                                                ✓ Correct
                                                            </button>
                                                            <button
                                                                onClick={() => onGradeAnswer(qObj.id, controllerId, false)}
                                                                disabled={ans.correct === false}
                                                                className="text-[10px] font-bold px-2 py-1 rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors disabled:opacity-40"
                                                            >
                                                                ✗ Incorrect
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </>
                )}
            </div>
            )}
            <style dangerouslySetInnerHTML={{__html: `
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
            `}} />
        </div>
    );
}
